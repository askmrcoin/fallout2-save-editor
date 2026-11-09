// bigstorage: raises the capacity of every container in Fallout 2
// (lockers, chests, bags, the car trunk) to 999.
//
// Usage:
//
//	go run ./tools/bigstorage ~/Fallout2            apply
//	go run ./tools/bigstorage ~/Fallout2 --restore  undo
//
// Works by writing patched copies of item protos (and the script that sets
// the car trunk size) into a separate archive patch050.dat next to
// master.dat. The engine loads patchNNN.dat files over master.dat.
// (Loose files in data/proto/items are wiped by the engine on load.)
// Saves are not touched.
package main

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const newSize = 999

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

const patchName = "patch050.dat"

type datFile struct {
	name string // DAT path with backslashes, e.g. PROTO\ITEMS\00000042.PRO
	data []byte
}

// writeDat writes an uncompressed DAT2 archive. Entries must be sorted
// case-insensitively because the engine looks them up with bsearch.
func writeDat(path string, files []datFile) error {
	sort.Slice(files, func(i, j int) bool {
		return strings.ToLower(files[i].name) < strings.ToLower(files[j].name)
	})
	var data, tree bytes.Buffer
	_ = binary.Write(&tree, binary.LittleEndian, uint32(len(files)))
	for _, f := range files {
		off := data.Len()
		data.Write(f.data)
		_ = binary.Write(&tree, binary.LittleEndian, uint32(len(f.name)))
		tree.WriteString(f.name)
		tree.WriteByte(0)
		_ = binary.Write(&tree, binary.LittleEndian, uint32(len(f.data)))
		_ = binary.Write(&tree, binary.LittleEndian, uint32(len(f.data)))
		_ = binary.Write(&tree, binary.LittleEndian, uint32(off))
	}
	var out bytes.Buffer
	out.Write(data.Bytes())
	out.Write(tree.Bytes())
	total := out.Len() + 8
	_ = binary.Write(&out, binary.LittleEndian, uint32(tree.Len()))
	_ = binary.Write(&out, binary.LittleEndian, uint32(total))
	return os.WriteFile(path, out.Bytes(), 0o644)
}

func listFiles(lst []byte) []string {
	var out []string
	for _, line := range strings.Split(strings.ReplaceAll(string(lst), "\r", ""), "\n") {
		f := strings.TrimSpace(strings.SplitN(strings.TrimSpace(line), " ", 2)[0])
		f = strings.SplitN(f, ";", 2)[0]
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

// set_car_carry_amount(N) compiles to: push int 52, push int N, op_metarule
var carryPrefix = []byte{0xC0, 0x01, 0, 0, 0, 52, 0xC0, 0x01}
var push52 = []byte{0xC0, 0x01, 0, 0, 0, 52}

func patchCarScript(b []byte) ([]byte, []int32, bool) {
	out := append([]byte(nil), b...)
	var found []int32
	other := false
	for i := 0; i+14 <= len(out); i++ {
		if bytes.Equal(out[i:i+8], carryPrefix) && out[i+12] == 0x81 && out[i+13] == 0x0B {
			found = append(found, int32(binary.BigEndian.Uint32(out[i+8:i+12])))
			binary.BigEndian.PutUint32(out[i+8:i+12], newSize)
			continue
		}
		if bytes.Equal(out[i:i+6], push52) {
			end := i + 40
			if end > len(out) {
				end = len(out)
			}
			if bytes.Contains(out[i+6:end], []byte{0x81, 0x0B}) {
				other = true
			}
		}
	}
	return out, found, other
}

func apply(root string) error {
	gs, err := openGameSources(filepath.Join(root, "x"))
	if err != nil {
		return err
	}
	var files []datFile

	lst, err := gs.read(`proto\items\items.lst`)
	if err != nil {
		return err
	}
	for _, file := range listFiles(lst) {
		data, err := gs.read(`proto\items\` + file)
		if err != nil || len(data) < 0x41 || be32(data, 0x20) != 1 {
			continue
		}
		old := be32(data, 0x39)
		if old >= newSize {
			continue
		}
		patched := append([]byte(nil), data...)
		binary.BigEndian.PutUint32(patched[0x39:], newSize)
		files = append(files, datFile{`PROTO\ITEMS\` + strings.ToUpper(file), patched})
		fmt.Printf("  container PID %d: %d -> %d\n", be32(data, 0), old, newSize)
	}
	fmt.Printf("Containers patched: %d\n", len(files))

	if slst, err := gs.read(`scripts\scripts.lst`); err == nil {
		for _, file := range listFiles(slst) {
			data, err := gs.read(`scripts\` + file)
			if err != nil {
				continue
			}
			patched, found, other := patchCarScript(data)
			if len(found) > 0 {
				files = append(files, datFile{`SCRIPTS\` + strings.ToUpper(file), patched})
				fmt.Printf("  script %s: car trunk sizes %v -> %d\n", file, found, newSize)
			} else if other {
				fmt.Printf("  script %s: possible car trunk size code (not patched)\n", file)
			}
		}
	}

	if len(files) == 0 {
		return errors.New("nothing to patch")
	}
	out := filepath.Join(root, patchName)
	if err := writeDat(out, files); err != nil {
		return err
	}
	fmt.Printf("Written %s (%d files). Restart the game. Undo with --restore\n", out, len(files))
	return nil
}

func restore(root string) error {
	removed := 0
	if err := os.Remove(filepath.Join(root, patchName)); err == nil {
		removed++
	}
	// Leftovers of the first version (files in data/ get wiped by the game anyway)
	if dataDir := findInDir(root, "data"); dataDir != "" {
		manifest := filepath.Join(dataDir, "bigstorage-manifest.txt")
		if b, err := os.ReadFile(manifest); err == nil {
			for _, p := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				if p == "" {
					continue
				}
				if _, err := os.Stat(p + ".bigstorage.bak"); err == nil {
					_ = os.Rename(p+".bigstorage.bak", p)
				} else {
					_ = os.Remove(p)
				}
			}
			_ = os.Remove(manifest)
			removed++
		}
	}
	fmt.Printf("Restore done (%d items removed)\n", removed)
	return nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: go run ./tools/bigstorage <Fallout2 folder> [--restore]")
		os.Exit(2)
	}
	root := os.Args[1]
	var err error
	if len(os.Args) > 2 && os.Args[2] == "--restore" {
		err = restore(root)
	} else {
		err = apply(root)
	}
	if err != nil {
		fmt.Println("Error:", err)
		os.Exit(1)
	}
}

func be32(b []byte, off int) int32 {
	if off+4 > len(b) {
		return 0
	}
	return int32(binary.BigEndian.Uint32(b[off : off+4]))
}
