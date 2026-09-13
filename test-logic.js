const fs = require("fs");
const html = fs.readFileSync("/workspace/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl() {
  return {
    value: "1", textContent: "", innerHTML: "", className: "", disabled: false, checked: false,
    style: {}, dataset: {}, title: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, querySelectorAll() { return []; }, closest() { return null; }
  };
}
const els = new Map();
const documentStub = {
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
  querySelectorAll() { return []; },
  elementFromPoint() { return null; },
  createElement() { return { click() {}, set href(v) {} }; }
};
let store = {};
const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const windowStub = { addEventListener() {} };
const inp = (id, v) => { documentStub.getElementById(id).value = String(v); };

const factory = new Function("window", "document", "localStorage", "Blob", "URL",
  script + `
  ;return {
    setDim(w,h){cols=w;rows=h;cells=new Array(w*h).fill(0);locked=new Array(w*h).fill(false);sel=null;clip=null;undoStack=[];redoStack=[];},
    setCell(x,y,v){cells[y*cols+x]=v;}, setLock(x,y,v){locked[y*cols+x]=v;},
    setSel(s){sel=s;}, setClip(c){clip=c;}, setAllow(v){allowOver=v;},
    transform, doCopy, doCut, doPaste, doTile, moveOrCopyTo, commitDrag, planPlace,
    msg(){return document.getElementById('message').textContent;},
    state(){return {cols,rows,cells:cells.slice(),locked:locked.slice(),sel:sel?{...sel}:null,clip};},
    undo, redo, reinit:init, grab:grabSelection, paintAt
  };`);

const api = factory(windowStub, documentStub, ls, function () {}, { createObjectURL: () => "", revokeObjectURL() {} });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); }
}
const arr = (w, h, rows) => ({ w, h, data: rows.flat() });
const fill = rows => rows.forEach((r, y) => r.forEach((v, x) => api.setCell(x, y, v)));
const at = (st, x, y) => st.cells[y * st.cols + x];
const clip22 = () => arr(2, 2, [[1, 2], [3, 4]]);

// 1. 非方形选区顺时针旋转：3x2 -> 2x3
api.setDim(8, 8);
fill([[1, 2, 3], [4, 5, 6]]);
api.setSel({ x0: 0, y0: 0, x1: 2, y1: 1 });
api.transform("rot");
let s = api.state();
check("旋转后宽高变化 2x3", s.sel.x1 === 1 && s.sel.y1 === 2, s.sel);
check("旋转矩阵内容正确 [4,1]/[5,2]/[6,3]",
  at(s, 0, 0) === 4 && at(s, 1, 0) === 1 && at(s, 0, 1) === 5 &&
  at(s, 1, 1) === 2 && at(s, 0, 2) === 6 && at(s, 1, 2) === 3,
  [at(s,0,0),at(s,1,0),at(s,0,1),at(s,1,1),at(s,0,2),at(s,1,2)]);

// 2. 水平翻转
api.setDim(8, 8);
fill([[1, 2, 3], [4, 5, 6]]);
api.setSel({ x0: 0, y0: 0, x1: 2, y1: 1 });
api.transform("flipH");
s = api.state();
check("水平翻转", [3, 2, 1, 6, 5, 4].every((v, i) => v === (i < 3 ? at(s, i, 0) : at(s, i - 3, 1))),
  [0,1,2].map(x=>at(s,x,0)).concat([0,1,2].map(x=>at(s,x,1))));

// 3. 垂直翻转
api.setDim(8, 8);
fill([[1, 2, 3], [4, 5, 6]]);
api.setSel({ x0: 0, y0: 0, x1: 2, y1: 1 });
api.transform("flipV");
s = api.state();
check("垂直翻转", [4, 5, 6, 1, 2, 3].every((v, i) => v === (i < 3 ? at(s, i, 0) : at(s, i - 3, 1))),
  [0,1,2].map(x=>at(s,x,0)).concat([0,1,2].map(x=>at(s,x,1))));

// 4. 旋转越界（非方形 2x3 贴右边界，旋后 3 宽超出）必须原子取消
api.setDim(4, 4);
[[1, 2], [3, 4], [5, 6]].forEach((r, yy) => r.forEach((v, k) => api.setCell(2 + k, 1 + yy, v)));
api.setSel({ x0: 2, y0: 1, x1: 3, y1: 3 });
const before = api.state().cells.join();
api.transform("rot");
s = api.state();
check("旋转越界被阻止且原子不变", s.cells.join() === before && /越界/.test(api.msg()), { msg: api.msg() });

// 5. 空选区操作提示
api.setDim(6, 6);
api.setSel({ x0: 0, y0: 0, x1: 1, y1: 1 });
api.doCopy();
check("空选区复制提示", /空/.test(api.msg()) && api.state().clip === null, api.msg());
api.transform("flipH");
check("空选区翻转提示", /空/.test(api.msg()), api.msg());

// 6. 无选区 / 空剪贴板
api.setSel(null);
api.doCopy();
check("无选区复制提示", /框选/.test(api.msg()), api.msg());
api.doPaste();
check("空剪贴板粘贴提示", /剪贴板为空/.test(api.msg()), api.msg());

// 7. 锁定冲突：剪切/翻转含锁格被阻止
api.setDim(6, 6);
api.setCell(0, 0, 1); api.setCell(1, 0, 2); api.setLock(1, 0, true);
api.setSel({ x0: 0, y0: 0, x1: 1, y1: 0 });
api.doCut();
check("含锁定格不能剪切", /锁定/.test(api.msg()) && api.state().cells[0] === 1, api.msg());
api.transform("flipH");
check("含锁定格不能翻转", /锁定/.test(api.msg()), api.msg());

// 8. 铺版越界 / 锁定 / 占用冲突，原子取消
api.setDim(6, 6);
api.setClip(clip22());
inp("pasteX", 5); inp("pasteY", 1); inp("repCols", 2); inp("repRows", 1);
api.doTile();
check("铺版越界取消", /越界/.test(api.msg()) && api.state().cells.every(v => v === 0), api.msg());

api.setDim(6, 6);
api.setClip(clip22());
api.setLock(2, 1, true);
inp("pasteX", 1); inp("pasteY", 1); inp("repCols", 2); inp("repRows", 1);
api.doTile();
check("铺版撞锁定格取消", /锁定格冲突/.test(api.msg()) && api.state().cells[1 * 6 + 2] === 0, api.msg());

api.setDim(6, 6);
api.setClip(clip22());
api.setCell(1, 0, 9);
inp("pasteX", 1); inp("pasteY", 1); inp("repCols", 2); inp("repRows", 1);
api.setAllow(false);
api.doTile();
check("铺版覆盖冲突取消（未勾选覆盖）", /覆盖已有纹样/.test(api.msg()) && api.state().cells[1] === 9, api.msg());

// 9. 勾选允许覆盖：非锁定可覆盖，锁定仍拒绝
api.setClip(clip22());
api.setAllow(true);
api.doTile();
s = api.state();
check("勾选覆盖后铺版成功", at(s,0,0)===1 && at(s,1,0)===2 && at(s,0,1)===3, [at(s,0,0),at(s,1,0),at(s,0,1)]);
api.setAllow(false);

api.setDim(6, 6);
api.setClip(clip22());
api.setCell(1, 0, 9); api.setLock(1, 0, true);
inp("pasteX", 1); inp("pasteY", 1); inp("repCols", 1); inp("repRows", 1);
api.setAllow(true);
api.doPaste();
check("勾选覆盖也不能覆盖锁定格", /锁定/.test(api.msg()) && api.state().cells[1] === 9, api.msg());
api.setAllow(false);

// 10. 正常铺版 3x2 个单元
api.setDim(6, 6);
api.setClip(clip22());
inp("pasteX", 1); inp("pasteY", 1); inp("repCols", 3); inp("repRows", 2);
api.doTile();
s = api.state();
check("铺版 3x2 单元落格",
  at(s,0,0)===1 && at(s,2,0)===1 && at(s,4,0)===1 && at(s,1,3)===4,
  { top:[0,2,4].map(x=>at(s,x,0)), r3c1:at(s,1,3) });
check("铺版后选区=整体足迹 6x4", s.sel.x1 === 5 && s.sel.y1 === 3, s.sel);

// 11. 变换整体撤销重做
api.setDim(8, 8);
fill([[1, 2, 3], [4, 5, 6]]);
api.setSel({ x0: 0, y0: 0, x1: 2, y1: 1 });
api.transform("flipH");
api.undo();
s = api.state();
check("撤销翻转恢复整图", [1,2,3,4,5,6].every((v,i)=>v===(i<3?at(s,i,0):at(s,i-3,1))),
  [0,1,2].map(x=>at(s,x,0)).concat([0,1,2].map(x=>at(s,x,1))));
api.redo();
s = api.state();
check("重做翻转", [3,2,1,6,5,4].every((v,i)=>v===(i<3?at(s,i,0):at(s,i-3,1))),
  [0,1,2].map(x=>at(s,x,0)).concat([0,1,2].map(x=>at(s,x,1))));

// 12. 移动含锁拒绝；复制含锁允许
api.setDim(8, 8);
api.setCell(0, 0, 1); api.setLock(0, 0, true); api.setCell(1, 0, 2);
api.setSel({ x0: 0, y0: 0, x1: 1, y1: 0 });
inp("pasteX", 4); inp("pasteY", 4);
api.moveOrCopyTo(false);
check("移动含锁定格被拒", /锁定/.test(api.msg()) && api.state().cells[0] === 1, api.msg());
api.moveOrCopyTo(true);
s = api.state();
check("复制含锁定格可复制来源", at(s,0,0)===1 && at(s,3,3)===1 && at(s,4,3)===2,
  { a:at(s,0,0), b:at(s,3,3), c:at(s,4,3), msg:api.msg() });

// 13. 拖拽移动冲突松手取消 / 勾选后成功
api.setDim(8, 8);
api.setCell(0, 0, 1); api.setCell(0, 1, 2); api.setCell(3, 0, 9);
const mot = api.grab({ x0: 0, y0: 0, x1: 0, y1: 1 });
api.setSel({ x0: 0, y0: 0, x1: 0, y1: 1 });
const d = mode => ({ mode, motif: mot, src: { x0: 0, y0: 0, x1: 0, y1: 1 }, startX: 0, startY: 0, curX: 3, curY: 0, moved: true });
api.commitDrag(d("move"));
s = api.state();
check("拖放冲突原子取消", /覆盖|锁定/.test(api.msg()) && at(s,0,0)===1 && at(s,0,1)===2 && at(s,3,0)===9, api.msg());
api.setAllow(true);
api.commitDrag(d("move"));
s = api.state();
check("勾选覆盖后拖放移动成功", at(s,3,0)===1 && at(s,3,1)===2 && at(s,0,0)===0,
  [at(s,3,0),at(s,3,1),at(s,0,0)]);
api.setAllow(false);

// 14. 单格旋转 1x1
api.setDim(5, 5);
api.setCell(2, 2, 7);
api.setSel({ x0: 2, y0: 2, x1: 2, y1: 2 });
api.transform("rot");
s = api.state();
check("单格旋转不变", at(s,2,2)===7 && s.sel.x0===2 && s.sel.y1===2, s.sel);

// 15. 旧存档 {cols,rows,cells} 打开不变
store = {};
ls.setItem("zfl31Pattern", JSON.stringify({ cols: 5, rows: 5, cells: Array(25).fill(2) }));
api.reinit(true);
s = api.state();
check("旧档尺寸还原", s.cols === 5 && s.rows === 5);
check("旧档纹样逐格不变", s.cells.every(v => v === 2));
check("旧档默认全未锁定", s.locked.every(v => v === false));

// 16. 新存档往返含锁定
store = {};
ls.setItem("zfl31Pattern", JSON.stringify({ version: 2, cols: 6, rows: 6, cells: Array(36).fill(0).map((_,i)=>i===0?3:0), locked: Array(36).fill(false).map((_,i)=>i===0) }));
api.reinit(true);
s = api.state();
check("新档纹样与锁定状态还原", at(s,0,0)===3 && s.locked[0]===true && s.locked[1]===false, { c:at(s,0,0), l0:s.locked[0] });

// 17. 剪贴板透明格不产生占用/越界
api.setDim(4, 4);
api.setCell(3, 3, 5);
const plan = api.planPlace(arr(2, 2, [[1, 0], [0, 0]]), 3, 3, 1, 1);
check("透明格不产生冲突", plan.targetCells.length === 1 && plan.occupied.length === 1 && plan.oob.length === 0, plan);

// 18. 绘制时锁定格被跳过且不改变
api.setDim(5, 5);
api.setLock(2, 2, true);
api.paintAt(2, 2, { painted: 0, skipped: [] });
check("绘制不修改锁定格", api.state().cells[2 * 5 + 2] === 0);

// 19. 非方形选区旋转四次还原（含宽高来回变化）
api.setDim(10, 10);
const base = [[1,2,3,4],[5,6,7,8],[9,10,11,12]]; // 4x3
base.forEach((r,y)=>r.forEach((v,x)=>api.setCell(x,y,v)));
api.setSel({x0:0,y0:0,x1:3,y1:2});
for (let k=0;k<4;k++) api.transform("rot");
s = api.state();
let ok4 = true;
base.forEach((r,y)=>r.forEach((v,x)=>{ if(at(s,x,y)!==v) ok4=false; }));
check("非方形旋转四次还原", ok4 && s.sel.x1===3 && s.sel.y1===2, s.sel);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
