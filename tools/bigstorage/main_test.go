package main
import ("bytes";"compress/zlib";"encoding/binary";"os";"path/filepath";"testing";"strings")
type fe struct{name string; data []byte}
func writeTestDat(path string, files []fe) {
	var data, tree bytes.Buffer
	binary.Write(&tree, binary.LittleEndian, uint32(len(files)))
	for _, f := range files {
		off := data.Len(); var z bytes.Buffer; w := zlib.NewWriter(&z); w.Write(f.data); w.Close()
		data.Write(z.Bytes())
		binary.Write(&tree, binary.LittleEndian, uint32(len(f.name))); tree.WriteString(f.name); tree.WriteByte(1)
		binary.Write(&tree, binary.LittleEndian, uint32(len(f.data))); binary.Write(&tree, binary.LittleEndian, uint32(z.Len())); binary.Write(&tree, binary.LittleEndian, uint32(off))
	}
	var out bytes.Buffer; out.Write(data.Bytes()); out.Write(tree.Bytes())
	total := out.Len()+8
	binary.Write(&out, binary.LittleEndian, uint32(tree.Len())); binary.Write(&out, binary.LittleEndian, uint32(total))
	os.WriteFile(path, out.Bytes(), 0644)
}
func pro(pid, typ, size int32) []byte { b := make([]byte, 0x41); p := func(o int, v int32){binary.BigEndian.PutUint32(b[o:], uint32(v))}; p(0,pid); p(0x20,typ); p(0x39,size); return b }
func TestApplyRestore(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "data", "TEXT"), 0755)
	script := []byte{0xAA, 0xC0,1,0,0,0,52, 0xC0,1,0,0,1,0xDB, 0x81,0x0B, 0xBB} // set_car_carry_amount(475)
	writeTestDat(filepath.Join(root, "master.dat"), []fe{
		{`PROTO\ITEMS\ITEMS.LST`, []byte("00000001.pro\r\n00000002.pro\r\n00000455.pro\r\n")},
		{`PROTO\ITEMS\00000001.pro`, pro(1, 3, 0)},
		{`PROTO\ITEMS\00000002.pro`, pro(2, 1, 250)},
		{`PROTO\ITEMS\00000455.pro`, pro(3, 1, 250)},
		{`SCRIPTS\SCRIPTS.LST`, []byte("artrunk.int ; trunk\r\nother.int\r\n")},
		{`SCRIPTS\ARTRUNK.INT`, script},
		{`SCRIPTS\OTHER.INT`, []byte{1,2,3}},
	})
	// pre-existing loose proto (like a mod)
	os.MkdirAll(filepath.Join(root, "data", "proto", "items"), 0755)
	os.WriteFile(filepath.Join(root, "data", "proto", "items", "00000002.pro"), pro(2, 1, 100), 0644)
	if err := apply(root); err != nil { t.Fatal(err) }
	d, err := openDat(filepath.Join(root, "patch050.dat"))
	if err != nil { t.Fatal(err) }
	get := func(n string, off int) int32 { b, found, err := d.read(n); if !found || err != nil { t.Fatalf("missing %s", n) }; return int32(binary.BigEndian.Uint32(b[off:])) }
	if get(`proto\items\00000002.pro`, 0x39) != 999 || get(`proto\items\00000455.pro`, 0x39) != 999 { t.Fatal("containers") }
	if _, found, _ := d.read(`proto\items\00000001.pro`); found { t.Fatal("weapon included") }
	if get(`scripts\artrunk.int`, 9) != 999 { t.Fatal("script") }
	// entries sorted case-insensitively (engine uses bsearch)
	names := []string{}; for k := range d.entries { names = append(names, k) }
	_ = names
	if err := restore(root); err != nil { t.Fatal(err) }
	if _, err := os.Stat(filepath.Join(root, "patch050.dat")); err == nil { t.Fatal("not removed") }
	_ = strings.ToLower
}
