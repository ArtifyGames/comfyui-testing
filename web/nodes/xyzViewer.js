import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_ID = "ArtifyXYZViewer";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name) || null;
}

function getWidgetInt(node, name, fallback = 0) {
  const value = Number(getWidget(node, name)?.value);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function getActiveFolderName(node) {
  return String(node.artifyLoadedFolder || getWidget(node, "folder_name")?.value || "").trim();
}

function isImageName(name) {
  const value = String(name || "").toLowerCase();
  for (const extension of IMAGE_EXTENSIONS) {
    if (value.endsWith(extension)) return true;
  }
  return false;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFilenameFromSrc(src) {
  const input = String(src || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(input, window.location.origin);
    const fromQuery = parsed.searchParams.get("filename");
    if (fromQuery) return safeDecode(fromQuery);
    const base = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return safeDecode(base);
  } catch {
    const base = input.split("?")[0].split("/").filter(Boolean).pop() || "";
    return safeDecode(base);
  }
}

function getImageFilename(entry) {
  if (!entry || typeof entry !== "object") return "";
  const byField = String(entry.filename || "").trim();
  if (byField) return safeDecode(byField);
  return parseFilenameFromSrc(entry.src);
}

function ensureStyles() {
  if (document.getElementById("artify-xyz-viewer-style")) return;

  const style = document.createElement("style");
  style.id = "artify-xyz-viewer-style";
  style.textContent = `
    .artify-xyz-root {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #161a20;
      border: 1px solid #2e3846;
      border-radius: 8px;
      padding: 10px;
      color: #d5dde8;
      font-family: sans-serif;
    }

    .artify-xyz-status {
      font-size: 12px;
      color: #9fb0c4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding-right: 2px;
    }

    .artify-xyz-flat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px;
    }

    .artify-xyz-empty {
      border: 1px dashed #3b4758;
      border-radius: 6px;
      padding: 16px;
      text-align: center;
      color: #9fb0c4;
      font-size: 12px;
    }

    .artify-xyz-item {
      border: 1px solid #334055;
      border-radius: 6px;
      background: #1e2530;
      overflow: hidden;
    }

    .artify-xyz-item img {
      display: block;
      width: 100%;
      height: 120px;
      object-fit: cover;
      background: #11161e;
    }

    .artify-xyz-name {
      font-size: 11px;
      color: #b8c6d8;
      padding: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-table-wrap {
      overflow: auto;
      max-height: 100%;
    }

    .artify-xyz-table {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
    }

    .artify-xyz-table th,
    .artify-xyz-table td {
      border: 1px solid #354255;
      background: #1e2530;
      padding: 6px;
      text-align: center;
      vertical-align: middle;
    }

    .artify-xyz-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #232c3a;
      color: #d8e1ec;
      font-size: 11px;
      max-width: 180px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-table tbody th {
      position: sticky;
      left: 0;
      z-index: 1;
      background: #232c3a;
      color: #d8e1ec;
      font-size: 11px;
      max-width: 220px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-cell {
      width: 120px;
      height: 120px;
      display: block;
      object-fit: cover;
      background: #0f141c;
      border-radius: 4px;
    }

    .artify-xyz-missing {
      width: 120px;
      height: 120px;
      display: grid;
      place-items: center;
      color: #8fa2b7;
      font-size: 11px;
      border: 1px dashed #455569;
      border-radius: 4px;
      background: #151b24;
    }
  `;

  document.head.appendChild(style);
}

function revokeObjectUrls(node) {
  if (!Array.isArray(node?.artifyObjectUrls)) return;
  for (const url of node.artifyObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore invalid or already-revoked URLs.
    }
  }
  node.artifyObjectUrls = [];
}

function setStatus(node, message) {
  if (!node?.artifyStatusEl) return;
  node.artifyStatusEl.textContent = String(message || "");
}

function sortByName(a, b) {
  const aName = String(a?.name || "");
  const bName = String(b?.name || "");
  return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: "base" });
}

function extractFolderNameFromPicker(picker, files) {
  if (picker?.webkitEntries?.length) {
    const dirEntry = Array.from(picker.webkitEntries).find((entry) => entry && entry.isDirectory);
    if (dirEntry?.name) return String(dirEntry.name).trim();
  }

  const first = files?.[0];
  if (!first) return "";

  const relPath = String(first.webkitRelativePath || "").trim();
  if (relPath.includes("/")) {
    return relPath.split("/")[0].trim();
  }

  return "";
}

function getAxesInfo(data) {
  const result = Array.isArray(data?.result) ? data.result : [];
  const xCount = result.length;
  const yRows = xCount > 0 && Array.isArray(result[0]?.children) ? result[0].children : [];
  const yCount = yRows.length;

  const firstCell = yCount > 0 && Array.isArray(yRows[0]?.children) ? yRows[0].children : [];
  const hasZAxis = firstCell.length > 0 && firstCell[0]?.type === "axis";

  const zCount = hasZAxis ? firstCell.length : 1;
  const firstImages = hasZAxis
    ? Array.isArray(firstCell[0]?.children)
      ? firstCell[0].children
      : []
    : firstCell;
  const batchCount = Math.max(1, firstImages.length || 1);

  return { xCount, yCount, zCount, batchCount, hasZAxis };
}

function getCellImageEntry(data, ix, iy, zIndex, batchIndex) {
  const xNode = data?.result?.[ix];
  const yNode = xNode?.children?.[iy];
  const cell = Array.isArray(yNode?.children) ? yNode.children : [];
  if (!cell.length) return null;

  const isZAxis = cell[0]?.type === "axis";
  if (isZAxis) {
    const zNode = cell[Math.min(Math.max(zIndex, 0), cell.length - 1)] || cell[0];
    const images = Array.isArray(zNode?.children) ? zNode.children : [];
    if (!images.length) return null;
    return images[Math.min(Math.max(batchIndex, 0), images.length - 1)] || images[0] || null;
  }

  return cell[Math.min(Math.max(batchIndex, 0), cell.length - 1)] || cell[0] || null;
}

function buildLocalImageMap(node, files) {
  revokeObjectUrls(node);
  node.artifyLocalImageMap = new Map();
  node.artifyObjectUrls = [];

  for (const file of files || []) {
    if (!isImageName(file?.name)) continue;
    const name = String(file.name || "").trim();
    if (!name) continue;

    const url = URL.createObjectURL(file);
    node.artifyObjectUrls.push(url);
    node.artifyLocalImageMap.set(name, url);
    node.artifyLocalImageMap.set(safeDecode(name), url);
  }
}

function resolveImageSrc(node, imageEntry) {
  if (!imageEntry || typeof imageEntry !== "object") return "";

  const filename = getImageFilename(imageEntry);
  if (filename && node.artifyLocalImageMap?.has(filename)) {
    return node.artifyLocalImageMap.get(filename) || "";
  }

  const src = String(imageEntry.src || "").trim();
  if (src) {
    if (/^(blob:|data:|https?:)/i.test(src)) return src;
    return src;
  }

  const folderName = getActiveFolderName(node);
  if (filename && folderName) {
    return `/view?filename=${encodeURIComponent(filename)}&type=output&subfolder=${encodeURIComponent(folderName)}`;
  }

  return "";
}

function renderEmptyState(node, message) {
  const content = node?.artifyContentEl;
  if (!content) return;

  content.replaceChildren();

  const empty = document.createElement("div");
  empty.className = "artify-xyz-empty";
  empty.textContent = message || "No images loaded.";
  content.appendChild(empty);
}

function renderFlatGrid(node, images) {
  const content = node?.artifyContentEl;
  if (!content) return;

  content.replaceChildren();

  if (!Array.isArray(images) || images.length === 0) {
    renderEmptyState(node, "No images found in this folder.");
    return;
  }

  const grid = document.createElement("div");
  grid.className = "artify-xyz-flat-grid";

  const fragment = document.createDocumentFragment();
  for (const image of images) {
    const item = document.createElement("div");
    item.className = "artify-xyz-item";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = image.src;
    img.alt = image.name;

    const name = document.createElement("div");
    name.className = "artify-xyz-name";
    name.textContent = image.name;

    item.appendChild(img);
    item.appendChild(name);
    fragment.appendChild(item);
  }

  grid.appendChild(fragment);
  content.appendChild(grid);
}

function renderMatrixGrid(node, data) {
  const content = node?.artifyContentEl;
  if (!content) return;

  const axes = getAxesInfo(data);
  if (axes.xCount < 1 || axes.yCount < 1) {
    renderEmptyState(node, "Invalid result.json axis structure.");
    return;
  }

  const zIndex = getWidgetInt(node, "z_index", 0);
  const batchIndex = getWidgetInt(node, "batch_index", 0);

  content.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "artify-xyz-table-wrap";

  const table = document.createElement("table");
  table.className = "artify-xyz-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const corner = document.createElement("th");
  corner.textContent = "Y \\ X";
  headerRow.appendChild(corner);

  for (let ix = 0; ix < axes.xCount; ix += 1) {
    const th = document.createElement("th");
    th.textContent = String(data.result[ix]?.value ?? `x${ix}`);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (let iy = 0; iy < axes.yCount; iy += 1) {
    const tr = document.createElement("tr");

    const yLabel = document.createElement("th");
    yLabel.textContent = String(data.result[0]?.children?.[iy]?.value ?? `y${iy}`);
    tr.appendChild(yLabel);

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const td = document.createElement("td");
      const entry = getCellImageEntry(data, ix, iy, zIndex, batchIndex);
      const src = resolveImageSrc(node, entry);

      if (src) {
        const img = document.createElement("img");
        img.className = "artify-xyz-cell";
        img.loading = "lazy";
        img.src = src;
        img.alt = getImageFilename(entry) || `${ix},${iy}`;
        td.appendChild(img);
      } else {
        const missing = document.createElement("div");
        missing.className = "artify-xyz-missing";
        missing.textContent = "Missing";
        td.appendChild(missing);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  content.appendChild(wrap);
}

function renderCurrentView(node) {
  if (node?.artifyViewMode === "matrix" && node?.artifyGridData) {
    renderMatrixGrid(node, node.artifyGridData);
  } else {
    renderFlatGrid(node, node?.artifyFlatImages || []);
  }
}

function statusForMatrix(node, folderLabel) {
  const axes = getAxesInfo(node.artifyGridData);
  const zIndex = Math.min(getWidgetInt(node, "z_index", 0), Math.max(0, axes.zCount - 1));
  const batchIndex = Math.min(getWidgetInt(node, "batch_index", 0), Math.max(0, axes.batchCount - 1));
  const zText = axes.hasZAxis ? `, z=${zIndex}` : "";
  return `${folderLabel} (${axes.xCount} x ${axes.yCount}, batch=${batchIndex}${zText})`;
}

function applyResultData(node, resultData, folderLabel) {
  node.artifyViewMode = "matrix";
  node.artifyGridData = resultData;
  node.artifyFlatImages = [];
  node.artifyLoadedFolder = String(folderLabel || "").trim();

  renderCurrentView(node);
  setStatus(node, statusForMatrix(node, node.artifyLoadedFolder || "selected folder"));
  node.setDirtyCanvas(true, true);
}

function applyFlatImages(node, images, folderLabel) {
  node.artifyViewMode = "flat";
  node.artifyGridData = null;
  node.artifyFlatImages = images;
  node.artifyLoadedFolder = String(folderLabel || "").trim();

  renderCurrentView(node);
  const count = images.length;
  setStatus(node, `${node.artifyLoadedFolder || "selected folder"} (${count} image${count === 1 ? "" : "s"})`);
  node.setDirtyCanvas(true, true);
}

async function parseResultJsonFromFiles(files) {
  const resultFile = (files || []).find((file) => String(file?.name || "").toLowerCase() === "result.json");
  if (!resultFile) return null;

  try {
    const text = await resultFile.text();
    const json = JSON.parse(text);
    if (json && typeof json === "object" && Array.isArray(json.result)) return json;
  } catch {
    // Ignore invalid result.json.
  }

  return null;
}

async function applyLocalFiles(node, files, folderLabel) {
  const localFiles = Array.isArray(files) ? files : [];
  const imagesOnly = localFiles.filter((file) => isImageName(file?.name)).sort(sortByName);

  node.artifyLastLocalFiles = localFiles;
  buildLocalImageMap(node, imagesOnly);

  const resultJson = await parseResultJsonFromFiles(localFiles);
  if (resultJson) {
    applyResultData(node, resultJson, folderLabel);
    return true;
  }

  const flat = imagesOnly.map((file) => {
    const name = String(file.name || "");
    return {
      name,
      src: node.artifyLocalImageMap.get(name) || "",
    };
  });

  applyFlatImages(node, flat, folderLabel);
  return flat.length > 0;
}

async function loadServerFolder(node, folderName) {
  const folder = String(folderName || "").trim();
  if (!folder) {
    setStatus(node, "Set folder_name or use Load Folder.");
    renderEmptyState(node, "No folder selected.");
    return false;
  }

  node.artifyLastLocalFiles = [];
  revokeObjectUrls(node);
  node.artifyLocalImageMap = new Map();

  setStatus(node, `Loading ${folder}...`);

  try {
    const resultResponse = await api.fetchApi(`/artify_testing/xyz/result?folder_name=${encodeURIComponent(folder)}`);
    if (resultResponse.ok) {
      const payload = await resultResponse.json();
      if (Array.isArray(payload?.result)) {
        applyResultData(node, payload, folder);
        return true;
      }
    }
  } catch {
    // Fallback to simple file list route.
  }

  try {
    const imageResponse = await api.fetchApi(`/artify_testing/xyz/images?folder_name=${encodeURIComponent(folder)}`);
    if (!imageResponse.ok) {
      const payload = await imageResponse.json().catch(() => ({}));
      setStatus(node, payload?.error || `Could not load folder '${folder}'.`);
      renderEmptyState(node, "No images found.");
      return false;
    }

    const payload = await imageResponse.json();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const flat = files
      .filter((name) => isImageName(name))
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }))
      .map((name) => ({
        name: String(name),
        src: `/view?filename=${encodeURIComponent(String(name))}&type=output&subfolder=${encodeURIComponent(folder)}`,
      }));

    applyFlatImages(node, flat, folder);
    return true;
  } catch (error) {
    console.error("[ArtifyXYZViewer] Failed to load folder:", error);
    setStatus(node, `Failed to load folder '${folder}'.`);
    renderEmptyState(node, "Failed to load folder.");
    return false;
  }
}

async function collectTopLevelFilesFromDirectoryHandle(dirHandle) {
  const files = [];

  for await (const entry of dirHandle.values()) {
    if (!entry || entry.kind !== "file") continue;
    try {
      files.push(await entry.getFile());
    } catch {
      // Ignore unreadable files.
    }
  }

  return files;
}

async function promptForFolder(node) {
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "read" });
      if (dirHandle?.name) {
        const files = await collectTopLevelFilesFromDirectoryHandle(dirHandle);
        await applyLocalFiles(node, files, dirHandle.name);
        return;
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn("[ArtifyXYZViewer] showDirectoryPicker failed, falling back:", error);
      }
    }
  }

  const picker = document.createElement("input");
  picker.type = "file";
  picker.style.display = "none";
  picker.multiple = true;
  picker.setAttribute("webkitdirectory", "");
  picker.setAttribute("directory", "");

  picker.addEventListener("change", async () => {
    const files = Array.from(picker.files || []);
    const folder = extractFolderNameFromPicker(picker, files) || "selected folder";
    await applyLocalFiles(node, files, folder);
    picker.remove();
  });

  document.body.appendChild(picker);
  picker.click();
}

function createViewerContainer() {
  ensureStyles();

  const root = document.createElement("div");
  root.className = "artify-xyz-root";

  const status = document.createElement("div");
  status.className = "artify-xyz-status";
  status.textContent = "Use Load Folder to pick a folder with images.";

  const content = document.createElement("div");
  content.className = "artify-xyz-content";

  const empty = document.createElement("div");
  empty.className = "artify-xyz-empty";
  empty.textContent = "No images loaded.";
  content.appendChild(empty);

  root.appendChild(status);
  root.appendChild(content);

  return { root, status, content };
}

app.registerExtension({
  name: "ArtifyTesting.XYZViewer",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalOnNodeCreated?.apply(this, arguments);

      this.artifyObjectUrls = [];
      this.artifyLocalImageMap = new Map();
      this.artifyLastLocalFiles = [];
      this.artifyLoadedFolder = "";
      this.artifyViewMode = "flat";
      this.artifyFlatImages = [];
      this.artifyGridData = null;

      if (!this.artifyDomWidget) {
        const { root, status, content } = createViewerContainer();
        this.artifyRootEl = root;
        this.artifyStatusEl = status;
        this.artifyContentEl = content;

        this.artifyDomWidget = this.addDOMWidget("xyz_grid", "custom", root, {
          serialize: false,
          hideOnZoom: false,
        });

        this.artifyDomWidget.computeSize = (width) => [Math.max(500, width), 440];
      }

      if (!this.widgets?.some((widget) => widget.name === "Load Folder")) {
        this.addWidget("button", "Load Folder", "", () => {
          void promptForFolder(this);
        });
      }

      if (!this.widgets?.some((widget) => widget.name === "Reload Grid")) {
        this.addWidget("button", "Reload Grid", "", () => {
          if (Array.isArray(this.artifyLastLocalFiles) && this.artifyLastLocalFiles.length > 0) {
            void applyLocalFiles(this, this.artifyLastLocalFiles, this.artifyLoadedFolder || "selected folder");
            return;
          }

          const folder = getActiveFolderName(this);
          if (folder) {
            void loadServerFolder(this, folder);
          }
        });
      }

      const folderWidget = getWidget(this, "folder_name");
      if (folderWidget) {
        const original = folderWidget.callback;
        folderWidget.callback = function (...args) {
          const ret = original?.apply(this, args);
          if (String(getWidget(this, "source_mode")?.value || "") === "load_folder") {
            const folder = String(folderWidget.value || "").trim();
            if (folder) {
              void loadServerFolder(this, folder);
            }
          }
          return ret;
        }.bind(this);
      }

      const sourceModeWidget = getWidget(this, "source_mode");
      if (sourceModeWidget) {
        const original = sourceModeWidget.callback;
        sourceModeWidget.callback = function (...args) {
          const ret = original?.apply(this, args);
          if (String(sourceModeWidget.value || "") === "load_folder") {
            const folder = getActiveFolderName(this);
            if (folder) {
              void loadServerFolder(this, folder);
            }
          }
          return ret;
        }.bind(this);
      }

      const redrawWidgets = new Set(["z_index", "batch_index"]);
      this.widgets?.forEach((widget) => {
        if (!redrawWidgets.has(widget.name)) return;
        const original = widget.callback;
        widget.callback = function (...args) {
          const ret = original?.apply(this, args);
          if (this.artifyViewMode === "matrix" && this.artifyGridData) {
            renderCurrentView(this);
            setStatus(this, statusForMatrix(this, this.artifyLoadedFolder || "selected folder"));
          }
          return ret;
        }.bind(this);
      });

      const size = this.computeSize();
      this.setSize([Math.max(size[0], 760), Math.max(size[1], 620)]);
      return result;
    };

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = originalOnExecuted?.apply(this, arguments);

      const folderFromUi = String(message?.plot_folder?.[0] || "").trim();
      if (folderFromUi) {
        const sourceMode = getWidget(this, "source_mode");
        if (!sourceMode || String(sourceMode.value || "") === "from_plot_output") {
          this.artifyLoadedFolder = folderFromUi;
          void loadServerFolder(this, folderFromUi);
        }
      }

      return result;
    };

    const originalOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      revokeObjectUrls(this);
      return originalOnRemoved?.apply(this, arguments);
    };
  },
});
