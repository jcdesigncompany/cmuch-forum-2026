// 前台頁面：停用右鍵選單與檢視原始碼、另存網頁、開發者工具的快捷鍵。
// 僅為基本防護，無法阻止有心人士取得原始碼。輸入框仍可使用右鍵（貼上等）。
(function () {
  "use strict";
  function editable(t) { return t && t.closest && t.closest("input, textarea, [contenteditable=true]"); }
  document.addEventListener("contextmenu", function (e) { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
    var block =
      k === "f12" ||
      (mod && (k === "u" || k === "s")) ||                        // 檢視原始碼、另存網頁
      (mod && (e.shiftKey || e.altKey) && ["i", "j", "c", "u"].indexOf(k) > -1); // 開發者工具
    if (block) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener("dragstart", function (e) { if (e.target && e.target.tagName === "IMG") e.preventDefault(); });
})();
