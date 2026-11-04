import { strict as assert } from 'node:assert';
import { createTilingGeometry } from '../src/framework/tiling-interface';
import { TILINGS_LIST } from '../src/framework/tilings';
for (const tiling of TILINGS_LIST) {
  const g = createTilingGeometry(tiling);
  for (let q = 0; q < 9; q++) for (let r = 0; r < 9; r++) {
    const p = { q, r };
    assert.deepEqual(g.pointToCell(g.cellToPoint(p)), p, `${tiling.id} round trip`);
    assert.equal(g.distance(p, p), 0);
    for (const neighbor of g.neighbors(p, 9, 9)) {
      assert(g.neighbors(neighbor, 9, 9).some(n => n.q === q && n.r === r), `${tiling.id} symmetry`);
      assert.equal(g.distance(p, neighbor), 1, `${tiling.id} neighbor distance`);
      assert.equal(g.distance(p, neighbor), g.distance(neighbor, p));
    }
    const span = [{ q: q - 4, r: r - 4 }];
    let rotated = span;
    const order = tiling.shape === 'square' ? 4 : 6;
    for (let i = 0; i < order; i++) rotated = g.rotate(rotated, 1);
    assert(rotated[0].q === span[0].q && rotated[0].r === span[0].r, `${tiling.id} rotation order`);
    const inverse = g.rotate(g.rotate(span, 1), -1);
    assert(inverse[0].q === span[0].q && inverse[0].r === span[0].r, `${tiling.id} inverse rotation`);
  }
}
console.log('Tiling properties pass for square and hex tilings');
