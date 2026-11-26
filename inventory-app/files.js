// 파일 관리 창. 왼쪽 = 업로드전 제품 탭, 가운데 = 선택한 제품(폴더) 내용,
// 오른쪽 = 체크한 제품들에 쓰는 버튼(포토샵/업로드 - 다음 단계에서 연결).
const api = window.files;
const tabListEl = document.getElementById("tabList");
const detailEl = document.getElementById("detail");
const selCountEl = document.getElementById("selCount");
const selectAllEl = document.getElementById("selectAll");

let state = { tabs: [], freeFolders: [], unsorted: [], tags: [], job: null };
const TAGS = "tags";
const UNSORTED = "unsorted";
let dismissedJobAt = null;
let namesRequested = false;
let activeId = null;
const checked = new Set();
const PHOTO_TYPE = "application/x-collectroom-photo";

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    return undefined;
  }
}

async function reload() {
  state = await api.list();
  const ids = new Set(state.tabs.map((t) => t.id));
  for (const id of [...checked]) if (!ids.has(id)) checked.delete(id);
  const unsortedOpen = activeId === UNSORTED && state.unsorted.length > 0;
  if (!ids.has(activeId) && !unsortedOpen) activeId = state.tabs[0]?.id ?? null;
  document.getElementById("freeFolders").innerHTML = state.freeFolders
    .map((f) => `<option value="${f.replace(/"/g, "&quot;")}"></option>`)
    .join("");
  renderJob();
  renderTags();
  renderTabs();
  // 입력 중인 칸이 있으면 다시 그리지 않는다(Claude 진행 알림으로 새로고침될 때 입력이 날아가지 않게).
  if (!detailEl.contains(document.activeElement)) renderDetail();
  renderActions();
  // 제품명이 없는 탭이 새로 생기면 한 번 자동으로 Claude에게 제품명을 받는다.
  const needNames = state.tabs.some((t) => !t.folder && !t.nameTried);
  if (needNames && !namesRequested && !(state.job && state.job.running)) {
    namesRequested = true;
    api.suggestNames();
  }
}

function renderJob() {
  const box = document.getElementById("job");
  const j = state.job;
  if (!j || (!j.running && j.finishedAt === dismissedJobAt)) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = "job" + (j.running ? "" : j.error ? " err" : " ok");
  box.innerHTML = "";
  if (j.running) box.appendChild(el("span", "spin"));
  box.appendChild(el("span", "", j.running ? j.message : j.error || j.message));
  if (!j.running) {
    const x = el("button", "x", "✕");
    x.addEventListener("click", () => {
      dismissedJobAt = j.finishedAt;
      renderJob();
    });
    box.appendChild(x);
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// 사진(같은 창 안에서 끄는 것)인지, 파인더에서 끌어온 파일인지
function isPhotoDrag(e) {
  return e.dataTransfer.types.includes(PHOTO_TYPE);
}
function isFileDrag(e) {
  return e.dataTransfer.types.includes("Files");
}

function renderTabs() {
  document.getElementById("tabCount").textContent = `${state.tabs.length}개`;
  tabListEl.innerHTML = "";
  if (state.unsorted.length) tabListEl.appendChild(unsortedRow());
  for (const t of state.tabs) {
    const row = el("div", "tab" + (t.id === activeId ? " active" : "") + (checked.has(t.id) ? " checked" : ""));
    // 사진 모서리 동그라미를 누르면 선택/해제(탭을 여는 클릭과 따로).
    const pic = el("div", "t-pic");
    const img = el("img");
    img.src = t.imageUrl || "";
    const check = el("span", "t-check");
    check.title = "선택";
    check.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>';
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      checked.has(t.id) ? checked.delete(t.id) : checked.add(t.id);
      renderTabs();
      renderActions();
    });
    pic.append(img, check);
    const text = el("div", "t-text");
    text.appendChild(el("div", "t-name" + (t.folder ? "" : " none"), t.folder || "제품명 없음"));
    const sub = el("div", "t-sub");
    sub.appendChild(el("span", "", `사진 ${t.photos.numbered.length + t.photos.thumbs.length + t.photos.others.length}`));
    // 업로드를 마친 플랫폼만 표시한다(후루츠만 올리고 인스타가 남은 경우 등).
    if (t.fruitsUploadedAt) sub.appendChild(el("span", "done-mark", "후루츠 ✓"));
    if (t.instaUploadedAt) sub.appendChild(el("span", "done-mark", "인스타 ✓"));
    text.appendChild(sub);
    row.append(pic, text);
    row.addEventListener("click", () => {
      activeId = t.id;
      renderTabs();
      renderDetail();
    });

    // 사진을 다른 탭 위에 놓으면 그 제품 폴더로 옮긴다. 파인더 파일이면 그 제품에 추가.
    row.addEventListener("dragover", (e) => {
      if (isPhotoDrag(e) || isFileDrag(e)) {
        e.preventDefault();
        row.classList.add("drop");
      }
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("drop");
      if (!t.folder) return toast("이 제품은 아직 제품명(폴더)이 없어요.");
      if (isPhotoDrag(e)) {
        const p = JSON.parse(e.dataTransfer.getData(PHOTO_TYPE));
        if (p.id === t.id) return;
        const r = await run(() => api.move(p.id, p.name, t.id));
        if (p.id === TAGS && r) toast(r.reading ? `${t.folder}에 소재 라벨로 넣었어요. 소재 읽는 중…` : "넣었어요. 다른 작업이 끝나면 탭에서 '태그에서 소재 읽기'를 눌러주세요.");
        else if (r !== undefined) toast(`${t.folder}(으)로 옮겼어요.`);
      } else {
        const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
        const added = await run(() => api.add(t.id, paths));
        if (added) toast(`${t.folder}에 ${added.length}장 추가했어요.`);
      }
      reload();
    });
    tabListEl.appendChild(row);
  }
  const all = state.tabs.length > 0 && checked.size === state.tabs.length;
  selectAllEl.textContent = all ? "선택 해제" : "전체 선택";
  // 하나라도 골랐으면 모든 탭에 동그라미를 보여서 이어서 고르기 쉽게 한다.
  document.querySelector(".tabs-col").classList.toggle("selecting", checked.size > 0);
}

// 분류 못 한(또는 분류 기다리는) 사진함. 여기 사진을 다른 탭에 끌어다 놓으면 그 제품으로 간다.
function unsortedRow() {
  const row = el("div", "tab unsorted-tab" + (activeId === UNSORTED ? " active" : ""));
  const pic = el("div", "t-pic");
  pic.appendChild(el("div", "u-icon", "?"));
  const text = el("div", "t-text");
  text.appendChild(el("div", "t-name", "미분류"));
  const sub = el("div", "t-sub");
  sub.appendChild(el("span", "", `사진 ${state.unsorted.length}`));
  text.appendChild(sub);
  row.append(pic, text);
  row.addEventListener("click", () => {
    activeId = UNSORTED;
    renderTabs();
    renderDetail();
  });
  row.addEventListener("dragover", (e) => {
    if (isPhotoDrag(e)) {
      e.preventDefault();
      row.classList.add("drop");
    }
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    row.classList.remove("drop");
    if (!isPhotoDrag(e)) return;
    const p = JSON.parse(e.dataTransfer.getData(PHOTO_TYPE));
    if (p.id === UNSORTED) return;
    await run(() => api.move(p.id, p.name, UNSORTED));
    reload();
  });
  return row;
}

function renderUnsorted() {
  const head = el("div", "sec-title");
  head.appendChild(el("h3", "", `미분류 사진 ${state.unsorted.length}장`));
  head.appendChild(el("span", "", "왼쪽 제품 탭에 끌어다 놓으면 그 제품으로 들어가요 · 두 번 클릭하면 크게 보기"));
  detailEl.appendChild(head);
  const again = el("button", "btn", "Claude에게 다시 정리 맡기기");
  again.disabled = !!(state.job && state.job.running);
  again.addEventListener("click", async () => {
    await run(() => api.sort());
    reload();
  });
  const bar = el("div", "d-actions");
  bar.style.marginBottom = "14px";
  bar.appendChild(again);
  detailEl.appendChild(bar);
  const grid = el("div", "grid");
  const pseudo = { id: UNSORTED };
  state.unsorted.forEach((n) => grid.appendChild(photoTile(pseudo, n, "", { reorderable: false })));
  detailEl.appendChild(grid);
}

// 오른쪽 태그 사진 칸
function renderTags() {
  const grid = document.getElementById("tagsGrid");
  grid.innerHTML = "";
  for (const n of state.tags) {
    const ph = el("div", "tag-ph");
    ph.draggable = true;
    ph.title = n;
    const img = el("img");
    ph.appendChild(img);
    ph.appendChild(deleteButton(TAGS, n));
    api.thumb(TAGS, n).then((src) => (img.src = src)).catch(() => {});
    ph.addEventListener("dblclick", () => api.openPhoto(TAGS, n));
    ph.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(PHOTO_TYPE, JSON.stringify({ id: TAGS, name: n, reorderable: false }));
      e.dataTransfer.effectAllowed = "move";
      ph.classList.add("dragging");
      // 드래그가 시작된 뒤에 펼쳐야 끌기가 끊기지 않는다.
      setTimeout(() => openDropPanel(n), 0);
    });
    ph.addEventListener("dragend", () => {
      ph.classList.remove("dragging");
      closeDropPanel();
    });
    grid.appendChild(ph);
  }
}

// 태그를 끌기 시작하면 제품 목록을 크게 펼쳐서 바로 놓을 수 있게 한다(스크롤 필요 없음).
const dropPanel = document.getElementById("dropPanel");
function openDropPanel(tagName) {
  dropPanel.innerHTML = "";
  dropPanel.appendChild(el("h4", "", "어느 제품의 태그예요?"));
  const list = el("div", "dp-list");
  dropPanel.appendChild(list);
  const tabs = state.tabs.filter((x) => x.folder);
  // 칸 크기는 그대로 두고, 창 높이에 다 안 들어가면 옆으로 줄을 늘린다.
  const perCol = Math.max(1, Math.floor((window.innerHeight - 90) / 74));
  const cols = Math.ceil(tabs.length / perCol);
  list.style.gridTemplateColumns = `repeat(${cols}, 316px)`;
  list.style.gridAutoFlow = "column";
  list.style.gridTemplateRows = `repeat(${Math.min(perCol, tabs.length)}, auto)`;
  dropPanel.style.width = `${cols * 324 + 16}px`;
  for (const t of tabs) {
    const it = el("div", "dp-item");
    const img = el("img");
    img.src = t.imageUrl || "";
    it.append(img, el("span", "", t.folder));
    it.addEventListener("dragover", (e) => {
      if (!isPhotoDrag(e)) return;
      e.preventDefault();
      it.classList.add("drop");
    });
    it.addEventListener("dragleave", () => it.classList.remove("drop"));
    it.addEventListener("drop", async (e) => {
      e.preventDefault();
      closeDropPanel();
      const r = await run(() => api.move(TAGS, tagName, t.id));
      if (r) toast(r.reading ? `${t.folder}에 넣었어요. 소재 읽는 중…` : "넣었어요. 다른 작업이 끝나면 탭에서 '태그에서 소재 읽기'를 눌러주세요.");
      reload();
    });
    list.appendChild(it);
  }
  dropPanel.classList.add("open");
}
function closeDropPanel() {
  dropPanel.classList.remove("open");
}

const tagsBox = document.getElementById("tagsBox");
tagsBox.addEventListener("dragover", (e) => {
  if (isFileDrag(e) || isPhotoDrag(e)) {
    e.preventDefault();
    tagsBox.classList.add("drop");
  }
});
tagsBox.addEventListener("dragleave", (e) => {
  if (!tagsBox.contains(e.relatedTarget)) tagsBox.classList.remove("drop");
});
tagsBox.addEventListener("drop", async (e) => {
  e.preventDefault();
  tagsBox.classList.remove("drop");
  if (isPhotoDrag(e)) {
    // 탭에 잘못 넣은 사진을 다시 태그 칸으로 빼기
    const p = JSON.parse(e.dataTransfer.getData(PHOTO_TYPE));
    if (p.id === TAGS) return;
    await run(() => api.move(p.id, p.name, TAGS));
  } else {
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
    const n = await run(() => api.addTags(paths));
    if (n === 0) toast("사진 파일이 없어요.");
  }
  reload();
});

function renderActions() {
  const n = checked.size;
  selCountEl.textContent = n ? `${n}개 선택됨` : "선택한 제품 없음";
  document.querySelectorAll(".act:not(.act-free)").forEach((b) => (b.disabled = n === 0));
}

function deleteButton(id, name) {
  const x = el("button", "x-del", "✕");
  x.title = "휴지통으로";
  x.draggable = false;
  x.addEventListener("mousedown", (e) => e.stopPropagation());
  x.addEventListener("dblclick", (e) => e.stopPropagation());
  x.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (await run(() => api.deletePhoto(id, name))) toast("휴지통으로 옮겼어요.");
    reload();
  });
  return x;
}

function photoTile(t, name, badge, { reorderable }) {
  const ph = el("div", "ph");
  ph.draggable = true;
  ph.title = name;
  const img = el("img");
  ph.appendChild(img);
  if (badge) ph.appendChild(el("span", "badge", badge));
  ph.appendChild(deleteButton(t.id, name));
  api.thumb(t.id, name).then((src) => (img.src = src)).catch(() => {});
  ph.addEventListener("dblclick", () => api.openPhoto(t.id, name));
  ph.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(PHOTO_TYPE, JSON.stringify({ id: t.id, name, reorderable }));
    e.dataTransfer.effectAllowed = "move";
    ph.classList.add("dragging");
  });
  ph.addEventListener("dragend", () => ph.classList.remove("dragging"));
  return ph;
}

function miniDrop(title, hint, onFiles) {
  const box = el("div", "mini-drop");
  box.appendChild(el("b", "", title));
  box.appendChild(el("span", "", hint));
  box.addEventListener("dragover", (e) => {
    if (isFileDrag(e)) {
      e.preventDefault();
      e.stopPropagation();
      box.classList.add("drop");
    }
  });
  box.addEventListener("dragleave", () => box.classList.remove("drop"));
  box.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove("drop");
    if (!isFileDrag(e)) return;
    await onFiles([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
    reload();
  });
  return box;
}

function renderDetail() {
  detailEl.innerHTML = "";
  if (activeId === UNSORTED) return renderUnsorted();
  const t = state.tabs.find((x) => x.id === activeId);
  if (!t) {
    detailEl.appendChild(el("div", "empty", "업로드전 상품이 없어요. 재고관리에서 업로드전으로 옮기면 여기에 탭이 생겨요."));
    return;
  }

  // 머리: 메루카리 사진 + 제품명 + 버튼
  const head = el("div", "d-head");
  const merc = el("img", "merc");
  merc.src = t.imageUrl || "";
  merc.title = "메루카리 상품 열기";
  merc.addEventListener("click", () => t.sourceUrl && api.openExternal(t.sourceUrl));
  const meta = el("div", "d-meta");
  meta.appendChild(el("div", "lbl", "제품명"));
  const name = el("input", "name-input");
  name.value = t.folder || "";
  name.placeholder = "제품명을 입력하면 업로드 파일에 폴더가 생겨요";
  name.setAttribute("list", "freeFolders");
  const saveName = async () => {
    const v = name.value.trim();
    if (!v || v === t.folder) return;
    const done = await run(() => api.setName(t.id, v));
    if (done) toast(t.folder ? "제품명을 바꿨어요." : "폴더를 만들었어요.");
    reload();
  };
  name.addEventListener("keydown", (e) => e.key === "Enter" && name.blur());
  name.addEventListener("blur", saveName);
  meta.appendChild(name);
  if (!t.folder) {
    const sug = el("div", "suggest");
    const busy = state.job && state.job.running;
    sug.appendChild(el("span", "", busy ? "Claude가 작업 중이에요…" : t.nameTried ? "제안을 못 받았어요." : ""));
    const b = el("button", "btn", "Claude에게 제품명 받기");
    b.disabled = !!busy;
    b.addEventListener("click", async () => {
      await run(() => api.suggestNames());
      reload();
    });
    sug.appendChild(b);
    meta.appendChild(sug);
  }
  meta.appendChild(el("div", "merc-title", t.mercariTitle || ""));
  const acts = el("div", "d-actions");
  const openBtn = el("button", "btn", "폴더 열기");
  openBtn.disabled = !t.folderExists;
  openBtn.addEventListener("click", () => api.openFolder(t.id));
  const finishBtn = el("button", "btn btn-finish");
  finishBtn.innerHTML = '넘기기<svg viewBox="0 0 16 16"><path d="M3 8h9.5M8.5 4l4 4-4 4"/></svg>';
  finishBtn.title = "업로드 완료 폴더로 옮기고 탭을 닫아요";
  finishBtn.addEventListener("click", async () => {
    if (!confirm(`"${t.folder || t.mercariTitle}" 을(를) 업로드 완료로 넘길까요?`)) return;
    await run(() => api.finish(t.id));
    toast("업로드 완료로 넘겼어요.");
    reload();
  });
  const txtBtn = el("button", "btn", t.hasTxt ? "설명 글 열기" : "설명 글 만들기");
  txtBtn.disabled = !t.folderExists;
  txtBtn.title = "txt를 텍스트 편집기로 열어요(없으면 양식대로 만들어서)";
  txtBtn.addEventListener("click", async () => {
    await run(() => api.openTxt(t.id));
    reload();
  });
  acts.append(openBtn, txtBtn);
  // 인스타 썸네일(실착 3:4)은 있는데 후루츠 썸네일(1:1)이 없으면 만들어 주는 버튼
  const thumbNames = t.photos.thumbs.map((n) => n.replace(/\.[^.]+$/, "").normalize("NFC"));
  if (thumbNames.includes("인스타 썸네일") && !thumbNames.includes("후루츠 썸네일")) {
    const sq = el("button", "btn", "후루츠 썸네일 만들기");
    sq.title = "인스타 썸네일을 흰 정사각형(1:1)에 넣어 후루츠 썸네일을 만들어요";
    sq.addEventListener("click", async () => {
      if (await run(() => api.makeFruitsThumb(t.id))) toast("후루츠 썸네일을 만들었어요.");
      reload();
    });
    acts.append(sq);
  }
  acts.append(finishBtn);
  meta.appendChild(acts);
  head.append(merc, meta);
  detailEl.appendChild(head);

  // 사진
  const sec = el("div", "sec");
  const st = el("div", "sec-title");
  st.appendChild(el("h3", "", "사진"));
  st.appendChild(el("span", "", "끌어서 순서 변경 · 왼쪽 탭에 놓으면 그 제품으로 이동 · 두 번 클릭하면 크게 보기"));
  sec.appendChild(st);
  const photos = el("div", "photos");
  if (!t.folderExists) {
    photos.appendChild(el("div", "no-folder", "제품명을 입력하면 폴더가 생기고, 그다음 사진을 여기로 끌어다 놓을 수 있어요."));
  } else {
    const grid = el("div", "grid");
    t.photos.thumbs.forEach((n) => grid.appendChild(photoTile(t, n, n.replace(/\.[^.]+$/, ""), { reorderable: false })));
    t.photos.numbered.forEach((n, i) => {
      const tile = photoTile(t, n, String(i + 1), { reorderable: true });
      // 번호 사진 위에 놓으면 그 앞으로 끼워 넣는다.
      tile.addEventListener("dragover", (e) => {
        if (!isPhotoDrag(e)) return;
        e.preventDefault();
        tile.classList.add("before");
      });
      tile.addEventListener("dragleave", () => tile.classList.remove("before"));
      tile.addEventListener("drop", async (e) => {
        if (!isPhotoDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        tile.classList.remove("before");
        const p = JSON.parse(e.dataTransfer.getData(PHOTO_TYPE));
        if (p.id !== t.id || !p.reorderable || p.name === n) return;
        const order = t.photos.numbered.filter((x) => x !== p.name);
        order.splice(order.indexOf(n), 0, p.name);
        await run(() => api.reorder(t.id, order));
        reload();
      });
      grid.appendChild(tile);
    });
    t.photos.others.forEach((n) => grid.appendChild(photoTile(t, n, n.replace(/\.[^.]+$/, ""), { reorderable: false })));
    photos.appendChild(grid);
    photos.appendChild(el("div", "drop-hint", "파인더에서 사진을 끌어다 놓으면 다음 번호로 추가돼요. 번호 사진을 빈 곳에 놓으면 맨 뒤로 가요."));

    photos.addEventListener("dragover", (e) => {
      if (isFileDrag(e) || isPhotoDrag(e)) {
        e.preventDefault();
        if (isFileDrag(e)) photos.classList.add("drop");
      }
    });
    photos.addEventListener("dragleave", (e) => {
      if (!photos.contains(e.relatedTarget)) photos.classList.remove("drop");
    });
    photos.addEventListener("drop", async (e) => {
      e.preventDefault();
      photos.classList.remove("drop");
      if (isPhotoDrag(e)) {
        const p = JSON.parse(e.dataTransfer.getData(PHOTO_TYPE));
        if (p.id !== t.id || !p.reorderable) return;
        const order = t.photos.numbered.filter((x) => x !== p.name).concat(p.name);
        await run(() => api.reorder(t.id, order));
      } else {
        const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
        const added = await run(() => api.add(t.id, paths));
        if (added) toast(`${added.length}장 추가했어요.`);
      }
      reload();
    });
  }
  sec.appendChild(photos);
  // 이 제품 전용 칸: 제품을 찾을 필요가 없어서 빠르다.
  if (t.folderExists) {
    const drops = el("div", "mini-drops");
    drops.appendChild(
      miniDrop("실착 사진", "인스타 썸네일 + 후루츠 썸네일(1:1)을 바로 만들어요", async (paths) => {
        const has = t.photos.thumbs.length > 0;
        const replace = has && confirm("이미 썸네일이 있어요. 새 실착 사진으로 바꿀까요?\n(취소하면 착용 사진으로만 추가해요)");
        const r = await run(() => api.addWorn(t.id, paths, replace));
        if (r) toast(r.includes("인스타 썸네일.jpg") ? "썸네일을 만들었어요." : "착용 사진으로 추가했어요.");
      })
    );
    drops.appendChild(
      miniDrop("실측 사진", "Claude가 이 사진만 보고 실측 칸을 채워요", async (paths) => {
        if (await run(() => api.addMeasure(t.id, paths))) toast("실측 읽는 중…");
      })
    );
    sec.appendChild(drops);
  }
  detailEl.appendChild(sec);

  // 실측 / 하자 - txt가 있으면 txt의 "- Size :" 줄과 ※ 줄을 바로 고친다.
  const saved = el("span", "saved", "저장됨");
  const flash = () => {
    saved.classList.add("show");
    setTimeout(() => saved.classList.remove("show"), 1200);
  };
  const s2 = el("div", "sec");
  const st2 = el("div", "sec-title");
  st2.appendChild(el("h3", "", "실측"));
  st2.appendChild(el("span", "", t.hasTxt ? "설명 글(txt)의 Size 줄" : "입력하면 설명 글(txt)이 양식대로 만들어져요"));
  st2.appendChild(saved);
  s2.appendChild(st2);
  const size = el("input", "field");
  size.value = t.size;
  size.placeholder = "예: M (어깨 46.5 / 가슴 55 / 소매 66.5 / 총장 68)";
  size.addEventListener("change", async () => {
    if (await run(() => api.saveListing(t.id, { size: size.value.trim() }))) flash();
    t.size = size.value.trim();
  });
  s2.appendChild(size);
  detailEl.appendChild(s2);

  // 소재 - txt의 "·" 줄. 사진을 한꺼번에 넣으면 Claude가 태그 사진에서 읽어 채운다.
  const sm = el("div", "sec");
  const stm = el("div", "sec-title");
  stm.appendChild(el("h3", "", "소재"));
  stm.appendChild(el("span", "", "한 줄에 하나씩 (· 는 자동) · 부위가 나뉘면 '겉감 면 97% 폴리우레탄 3%'처럼"));
  if (t.photos.others.some((n) => n.normalize("NFC").startsWith("소재"))) {
    const rb = el("button", "btn", "태그에서 소재 읽기");
    rb.style.marginLeft = "auto";
    rb.disabled = !!(state.job && state.job.running);
    rb.addEventListener("click", async () => {
      await run(() => api.readMaterials(t.id));
      reload();
    });
    stm.appendChild(rb);
  }
  sm.appendChild(stm);
  const materials = el("textarea", "field");
  materials.value = (t.materials || []).join("\n");
  materials.placeholder = "예: 면 100%";
  materials.addEventListener("change", async () => {
    const list = materials.value.split("\n").map((l) => l.replace(/^·\s*/, "").trim()).filter(Boolean);
    if (await run(() => api.saveListing(t.id, { materials: list }))) flash();
    t.materials = list;
  });
  sm.appendChild(materials);
  detailEl.appendChild(sm);

  const s3 = el("div", "sec");
  const st3 = el("div", "sec-title");
  st3.appendChild(el("h3", "", "하자"));
  st3.appendChild(el("span", "", "한 줄에 하나씩 (※ 는 자동으로 붙어요)"));
  s3.appendChild(st3);
  const defects = el("textarea", "field");
  defects.value = t.defects.join("\n");
  defects.placeholder = "예: 좌측 소매 이염 (마지막 사진 참조)";
  defects.addEventListener("change", async () => {
    const list = defects.value.split("\n").map((l) => l.replace(/^※\s*/, "").trim()).filter(Boolean);
    if (await run(() => api.saveListing(t.id, { defects: list }))) flash();
    t.defects = list;
  });
  s3.appendChild(defects);
  detailEl.appendChild(s3);
}

selectAllEl.addEventListener("click", () => {
  const all = checked.size === state.tabs.length;
  checked.clear();
  if (!all) state.tabs.forEach((t) => checked.add(t.id));
  renderTabs();
  renderActions();
});

const ACTIONS = {
  "photoshop-bg": () => api.psBackground(),
  resize: () => api.psFit(),
  saveall: () => api.psSaveAll(),
  fruits: (ids) => confirmUpload(ids, ["fruits"]),
  insta: (ids) => confirmUpload(ids, ["insta"]),
  both: (ids) => confirmUpload(ids, ["fruits", "insta"]),
};

// 실제로 공개 게시되는 일이라 누르기 전에 한 번 묻는다.
function confirmUpload(ids, platforms) {
  const names = state.tabs.filter((t) => ids.includes(t.id)).map((t) => `· ${t.folder || t.mercariTitle}`);
  const where = platforms.map((p) => (p === "fruits" ? "후루츠" : "인스타")).join(" + ");
  if (!confirm(`${where}에 올릴까요?\n\n${names.join("\n")}\n\n제품당 몇 분씩 걸리고, 그동안 크롬에서 Claude가 작업해요.`)) return null;
  return api.upload(ids, platforms);
}
document.querySelectorAll(".act").forEach((b) =>
  b.addEventListener("click", async () => {
    const fn = ACTIONS[b.dataset.act];
    if (!fn) return toast(`"${b.textContent}"은 아직 연결 전이에요.`);
    await run(() => fn([...checked]));
    reload();
  })
);

// 창 밖(파인더)에서 놓친 파일이 창에 떨어져도 파일을 열어버리지 않게 막는다.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

const bulk = document.getElementById("bulk");
bulk.addEventListener("dragover", (e) => {
  if (isFileDrag(e)) {
    e.preventDefault();
    bulk.classList.add("drop");
  }
});
bulk.addEventListener("dragleave", () => bulk.classList.remove("drop"));
bulk.addEventListener("drop", async (e) => {
  e.preventDefault();
  bulk.classList.remove("drop");
  if (!isFileDrag(e)) return;
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
  const n = await run(() => api.addUnsorted(paths));
  if (n) toast(`${n}장 받았어요. Claude가 정리 중이에요.`);
  else if (n === 0) toast("사진 파일이 없어요.");
  reload();
});

api.onChanged(reload);
// 파인더에서 직접 폴더를 고쳤을 수도 있으니 창에 돌아올 때마다 다시 읽는다.
window.addEventListener("focus", reload);
reload();
