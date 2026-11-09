package main

// Reads Fallout 2 item prototypes (proto/items/*.pro) from the game's data
// so the editor knows each item's type, art (FID) and default values.
// Lookup order matches the engine: loose files in data/, then patch000.dat,
// then master.dat.

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type ItemProto struct {
	Pid            int32  `json:"pid"`
	Type           int32  `json:"type"`
	Fid            int32  `json:"fid"`
	Flags          int32  `json:"flags"`
	LightDistance  int32  `json:"lightDistance"`
	LightIntensity int32  `json:"lightIntensity"`
	Name           string `json:"name"`
	AmmoTypePid    int32  `json:"ammoTypePid"`
	AmmoCapacity   int32  `json:"ammoCapacity"`
	AmmoQuantity   int32  `json:"ammoQuantity"`
	Charges        int32  `json:"charges"`
	KeyCode        int32  `json:"keyCode"`
}

type datEntry struct {
	compressed byte
	realSize   uint32
	packedSize uint32
	offset     uint32
}

type datArchive struct {
	path       string
	dataOffset int64
	entries    map[string]datEntry
}

func normDatPath(p string) string {
	return strings.ToLower(strings.ReplaceAll(p, "/", "\\"))
}

func openDat(path string) (*datArchive, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := st.Size()
	if size < 8 {
		return nil, errors.New("dat too small")
	}

	footer := make([]byte, 8)
	if _, err := f.ReadAt(footer, size-8); err != nil {
		return nil, err
	}
	treeSize := int64(binary.LittleEndian.Uint32(footer[0:4]))
	dataSize := int64(binary.LittleEndian.Uint32(footer[4:8]))
	treeStart := size - treeSize - 8
	if treeStart < 0 || treeSize < 4 {
		return nil, errors.New("bad dat footer")
	}

	tree := make([]byte, treeSize)
	if _, err := f.ReadAt(tree, treeStart); err != nil {
		return nil, err
	}

	count := binary.LittleEndian.Uint32(tree[0:4])
	pos := 4
	entries := make(map[string]datEntry, count)
	for i := uint32(0); i < count; i++ {
		if pos+4 > len(tree) {
			return nil, errors.New("truncated dat tree")
		}
		nameLen := int(binary.LittleEndian.Uint32(tree[pos : pos+4]))
		pos += 4
		if pos+nameLen+13 > len(tree) {
			return nil, errors.New("truncated dat entry")
		}
		name := string(tree[pos : pos+nameLen])
		pos += nameLen
		e := datEntry{
			compressed: tree[pos],
			realSize:   binary.LittleEndian.Uint32(tree[pos+1 : pos+5]),
			packedSize: binary.LittleEndian.Uint32(tree[pos+5 : pos+9]),
			offset:     binary.LittleEndian.Uint32(tree[pos+9 : pos+13]),
		}
		pos += 13
		entries[normDatPath(name)] = e
	}

	return &datArchive{path: path, dataOffset: size - dataSize, entries: entries}, nil
}

func (d *datArchive) read(name string) ([]byte, bool, error) {
	e, ok := d.entries[normDatPath(name)]
	if !ok {
		return nil, false, nil
	}
	f, err := os.Open(d.path)
	if err != nil {
		return nil, true, err
	}
	defer f.Close()

	packed := make([]byte, e.packedSize)
	if _, err := f.ReadAt(packed, d.dataOffset+int64(e.offset)); err != nil {
		return nil, true, err
	}
	if e.compressed == 0 {
		return packed, true, nil
	}
	r, err := zlib.NewReader(bytes.NewReader(packed))
	if err != nil {
		return nil, true, err
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	return out, true, err
}

// gameSources resolves files the same way the engine does.
type gameSources struct {
	dataDir string
	looseIx map[string]string // lower-case relative path -> real path
	dats    []*datArchive     // patch000.dat first, then master.dat
	master  *datArchive
}

func findInDir(dir, lowerName string) string {
	items, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, it := range items {
		if strings.ToLower(it.Name()) == lowerName {
			return filepath.Join(dir, it.Name())
		}
	}
	return ""
}

func findGameRoot(start string) (string, error) {
	dir := start
	if st, err := os.Stat(dir); err == nil && !st.IsDir() {
		dir = filepath.Dir(dir)
	}
	for i := 0; i < 8; i++ {
		if findInDir(dir, "master.dat") != "" {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("master.dat not found above '%s'", start)
}

func openGameSources(savePath string) (*gameSources, error) {
	root, err := findGameRoot(savePath)
	if err != nil {
		return nil, err
	}
	gs := &gameSources{looseIx: map[string]string{}}

	if dataDir := findInDir(root, "data"); dataDir != "" {
		gs.dataDir = dataDir
		_ = filepath.WalkDir(dataDir, func(p string, de os.DirEntry, err error) error {
			if err != nil || de.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(dataDir, p)
			if err == nil {
				gs.looseIx[normDatPath(rel)] = p
			}
			return nil
		})
	}

	if p := findInDir(root, "patch000.dat"); p != "" {
		if d, err := openDat(p); err == nil {
			gs.dats = append(gs.dats, d)
		}
	}
	masterPath := findInDir(root, "master.dat")
	master, err := openDat(masterPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read master.dat: %w", err)
	}
	gs.dats = append(gs.dats, master)
	gs.master = master
	return gs, nil
}

func (gs *gameSources) read(name string) ([]byte, error) {
	if p, ok := gs.looseIx[normDatPath(name)]; ok {
		return os.ReadFile(p)
	}
	for _, d := range gs.dats {
		data, found, err := d.read(name)
		if found {
			return data, err
		}
	}
	return nil, fmt.Errorf("'%s' not found in game data", name)
}

var msgLine = regexp.MustCompile(`\{(\d+)\}\{[^}]*\}\{([^}]*)\}`)

func parseMsg(data []byte) map[int32]string {
	out := map[int32]string{}
	for _, m := range msgLine.FindAllSubmatch(data, -1) {
		id, err := strconv.Atoi(string(m[1]))
		if err == nil {
			out[int32(id)] = strings.TrimSpace(string(m[2]))
		}
	}
	return out
}

func be32(b []byte, off int) int32 {
	if off+4 > len(b) {
		return 0
	}
	return int32(binary.BigEndian.Uint32(b[off : off+4]))
}

func parseItemProto(b []byte) (ItemProto, error) {
	if len(b) < 0x39 {
		return ItemProto{}, errors.New("proto too short")
	}
	p := ItemProto{
		Pid:            be32(b, 0x00),
		Fid:            be32(b, 0x08),
		LightDistance:  be32(b, 0x0C),
		LightIntensity: be32(b, 0x10),
		Flags:          be32(b, 0x14),
		Type:           be32(b, 0x20),
		AmmoTypePid:    -1,
		KeyCode:        -1,
	}
	switch p.Type {
	case 3: // weapon
		p.AmmoTypePid = be32(b, 0x71)
		p.AmmoCapacity = be32(b, 0x75)
	case 4: // ammo
		p.AmmoQuantity = be32(b, 0x3D)
	case 5: // misc
		p.Charges = be32(b, 0x41)
	case 6: // key
		p.KeyCode = be32(b, 0x39)
	}
	return p, nil
}

func readItemProtos(savePath string) ([]ItemProto, error) {
	gs, err := openGameSources(savePath)
	if err != nil {
		return nil, err
	}

	lst, err := gs.read(`proto\items\items.lst`)
	if err != nil {
		return nil, err
	}

	// Item names in English from master.dat (translations may use other encodings)
	names := map[int32]string{}
	if data, found, _ := gs.master.read(`text\english\game\pro_item.msg`); found {
		names = parseMsg(data)
	}

	var out []ItemProto
	lines := strings.Split(strings.ReplaceAll(string(lst), "\r", ""), "\n")
	for i, line := range lines {
		file := strings.TrimSpace(strings.SplitN(line, " ", 2)[0])
		if file == "" {
			continue
		}
		data, err := gs.read(`proto\items\` + file)
		if err != nil {
			continue
		}
		p, err := parseItemProto(data)
		if err != nil {
			continue
		}
		if p.Pid != int32(i+1) {
			p.Pid = int32(i + 1)
		}
		msgID := be32(data, 0x04)
		p.Name = names[msgID]
		out = append(out, p)
	}

	if len(out) == 0 {
		return nil, errors.New("no item protos found")
	}
	return out, nil
}

// ReadItemProtos returns [json, error] with all item prototypes of the game
// that the given save file belongs to.
func (s *FileService) ReadItemProtos(savePath string) [2]string {
	protos, err := readItemProtos(savePath)
	if err != nil {
		return [2]string{"", err.Error()}
	}
	data, err := json.Marshal(protos)
	if err != nil {
		return [2]string{"", err.Error()}
	}
	return [2]string{string(data), ""}
}
