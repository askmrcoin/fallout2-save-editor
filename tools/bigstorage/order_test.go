package main
import ("encoding/binary";"os";"path/filepath";"strings";"testing")
func TestOrder(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.dat")
	writeDat(p, []datFile{{`PROTO\ITEMS\00000455.PRO`, []byte{1}}, {`SCRIPTS\A.INT`, []byte{2}}, {`PROTO\ITEMS\00000042.PRO`, []byte{3}}})
	b, _ := os.ReadFile(p); tree := int(binary.LittleEndian.Uint32(b[len(b)-8:])); pos := len(b)-8-tree+4
	prev := ""
	for i := 0; i < 3; i++ { n := int(binary.LittleEndian.Uint32(b[pos:])); name := string(b[pos+4:pos+4+n]); pos += 4+n+13; if strings.ToLower(name) < prev { t.Fatal("unsorted") }; prev = strings.ToLower(name); t.Log(name) }
}
