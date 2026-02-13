import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_ID = "ArtifyXYZViewer";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const Y_LABEL_COL_WIDTH = 72;

function getActiveFolderName(node) {
  return String(node.artifyLoadedFolder || "").trim();
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
      background: #1f1f1f;
      border: 1px solid #3b3b3b;
      border-radius: 8px;
      padding: 10px;
      color: #d7d7d7;
      font-family: sans-serif;
    }

    .artify-xyz-status {
      font-size: 12px;
      color: #a8a8a8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-legend {
      font-size: 11px;
      color: #b8b8b8;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      line-height: 1.2;
    }

    .artify-xyz-legend-item {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    .artify-xyz-content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }

    .artify-xyz-flat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--artify-cell-size, 120px), 1fr));
      gap: 8px;
    }

    .artify-xyz-empty {
      border: 1px dashed #4a4a4a;
      border-radius: 6px;
      padding: 16px;
      text-align: center;
      color: #a8a8a8;
      font-size: 12px;
    }

    .artify-xyz-item {
      border: 1px solid #444444;
      border-radius: 6px;
      background: #262626;
      overflow: hidden;
    }

    .artify-xyz-item img {
      display: block;
      width: 100%;
      height: var(--artify-cell-size, 120px);
      object-fit: cover;
      background: #171717;
    }

    .artify-xyz-name {
      font-size: 11px;
      color: #bbbbbb;
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

    .artify-xyz-y-col {
      width: ${Y_LABEL_COL_WIDTH}px;
      min-width: ${Y_LABEL_COL_WIDTH}px;
      max-width: ${Y_LABEL_COL_WIDTH}px;
    }

    .artify-xyz-img-col {
      width: var(--artify-cell-size, 120px);
      min-width: var(--artify-cell-size, 120px);
      max-width: var(--artify-cell-size, 120px);
    }

    .artify-xyz-table th,
    .artify-xyz-table td {
      border: 1px solid #4a4a4a;
      background: #262626;
      text-align: center;
      vertical-align: middle;
    }

    .artify-xyz-table th {
      padding: 6px;
    }

    .artify-xyz-table td {
      padding: 0;
      overflow: hidden;
    }

    .artify-xyz-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #2d2d2d;
      color: #d3d3d3;
      font-size: 11px;
      max-width: 180px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-col-head {
      width: var(--artify-cell-size, 120px);
      min-width: var(--artify-cell-size, 120px);
      max-width: var(--artify-cell-size, 120px);
      padding: 4px 2px;
      font-size: 10px;
    }

    .artify-xyz-y-col-head {
      width: ${Y_LABEL_COL_WIDTH}px;
      min-width: ${Y_LABEL_COL_WIDTH}px;
      max-width: ${Y_LABEL_COL_WIDTH}px;
      padding: 4px 4px;
      font-size: 10px;
    }

    .artify-xyz-table tbody th {
      position: sticky;
      left: 0;
      z-index: 1;
      background: #2d2d2d;
      color: #d3d3d3;
      font-size: 11px;
      width: ${Y_LABEL_COL_WIDTH}px;
      min-width: ${Y_LABEL_COL_WIDTH}px;
      max-width: ${Y_LABEL_COL_WIDTH}px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .artify-xyz-img-td {
      width: var(--artify-cell-size, 120px);
      min-width: var(--artify-cell-size, 120px);
      max-width: var(--artify-cell-size, 120px);
      height: var(--artify-cell-size, 120px);
      min-height: var(--artify-cell-size, 120px);
      max-height: var(--artify-cell-size, 120px);
    }

    .artify-xyz-cell {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      background: #141414;
    }

    .artify-xyz-missing {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      color: #9a9a9a;
      font-size: 11px;
      background: #1d1d1d;
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

function getAxisAnnotation(data, axisLetter) {
  const annotations = Array.isArray(data?.annotations) ? data.annotations : [];
  const axis = String(axisLetter || "").toUpperCase();
  return annotations.find((item) => String(item?.axis || "").toUpperCase() === axis) || null;
}

function parseNodeTitleFromAnnotationKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  return raw.replace(/^#\d+\s*/, "").trim();
}

function getAxisLegendText(data, axisLetter) {
  const item = getAxisAnnotation(data, axisLetter);
  if (!item) return "";

  const nodeTitle = parseNodeTitleFromAnnotationKey(item.key);
  const widgetName = String(item.type || "").trim();
  if (nodeTitle && widgetName) return `${nodeTitle}_${widgetName}`;
  return nodeTitle || widgetName;
}

function collectLegendParts(data) {
  const parts = [];
  for (const axis of ["X", "Y", "Z"]) {
    const legendText = getAxisLegendText(data, axis);
    if (legendText) {
      parts.push({ axis, text: legendText });
    }
  }
  return parts;
}

function renderLegend(node) {
  const legend = node?.artifyLegendEl;
  if (!legend) return;

  legend.replaceChildren();
  if (!(node?.artifyViewMode === "matrix" && node?.artifyGridData)) {
    legend.style.display = "none";
    return;
  }

  const parts = collectLegendParts(node.artifyGridData);

  if (!parts.length) {
    legend.style.display = "none";
    return;
  }

  legend.style.display = "flex";
  for (const part of parts) {
    const item = document.createElement("div");
    item.className = "artify-xyz-legend-item";
    item.textContent = `${part.axis}=${part.text}`;
    item.title = item.textContent;
    legend.appendChild(item);
  }
}

function getAutoCellSize(node) {
  const content = node?.artifyContentEl;
  const width = Math.max(200, Math.floor(content?.clientWidth || node?.size?.[0] || 700));
  const height = Math.max(160, Math.floor(content?.clientHeight || node?.size?.[1] || 500));

  if (node?.artifyViewMode === "matrix" && node?.artifyGridData) {
    const axes = getAxesInfo(node.artifyGridData);
    const cols = Math.max(1, axes.xCount * (axes.hasZAxis ? axes.zCount : 1));
    const rows = Math.max(1, axes.yCount);

    const labelColumnWidth = Y_LABEL_COL_WIDTH;
    const headerHeight = axes.hasZAxis ? 58 : 36;
    const perCellHorizontalChrome = 14;
    const perCellVerticalChrome = 14;

    const usableW = Math.max(120, width - labelColumnWidth);
    const usableH = Math.max(120, height - headerHeight);

    const byWidth = Math.floor(usableW / cols) - perCellHorizontalChrome;
    const rowBudget = Math.floor(usableH / rows) - perCellVerticalChrome;
    const byHeight = rowBudget;

    return Math.max(32, Math.min(byWidth, byHeight));
  }

  const imageCount = Math.max(1, node?.artifyFlatImages?.length || 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(imageCount)));
  const rows = Math.max(1, Math.ceil(imageCount / cols));
  const gap = 8;
  const labelHeight = 24;

  const byWidth = Math.floor((width - gap * (cols - 1)) / cols);
  const byHeight = Math.floor((height - gap * (rows - 1)) / rows) - labelHeight;

  return Math.max(48, Math.min(byWidth, byHeight > 0 ? byHeight : byWidth));
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
  const batchIndex = 0;

  content.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "artify-xyz-table-wrap";

  const table = document.createElement("table");
  table.className = "artify-xyz-table";

  const hasZAxis = axes.hasZAxis;
  const imageColCount = axes.xCount * (hasZAxis ? axes.zCount : 1);

  const colgroup = document.createElement("colgroup");
  const yCol = document.createElement("col");
  yCol.className = "artify-xyz-y-col";
  colgroup.appendChild(yCol);
  for (let i = 0; i < imageColCount; i += 1) {
    const col = document.createElement("col");
    col.className = "artify-xyz-img-col";
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const thead = document.createElement("thead");

  if (hasZAxis) {
    const topRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "artify-xyz-y-col-head";
    corner.textContent = "Y \\ X/Z";
    corner.title = corner.textContent;
    corner.rowSpan = 2;
    topRow.appendChild(corner);

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const xTh = document.createElement("th");
      xTh.colSpan = axes.zCount;
      xTh.textContent = `X=${String(data.result[ix]?.value ?? `x${ix}`)}`;
      xTh.title = xTh.textContent;
      topRow.appendChild(xTh);
    }
    thead.appendChild(topRow);

    const zRow = document.createElement("tr");
    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const firstCell = data.result[ix]?.children?.[0]?.children || [];
      for (let iz = 0; iz < axes.zCount; iz += 1) {
        const zTh = document.createElement("th");
        zTh.className = "artify-xyz-col-head";
        const zNode = firstCell[iz];
        zTh.textContent = `Z=${String(zNode?.value ?? `z${iz}`)}`;
        zTh.title = zTh.textContent;
        zRow.appendChild(zTh);
      }
    }
    thead.appendChild(zRow);
  } else {
    const headerRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "artify-xyz-y-col-head";
    corner.textContent = "Y \\ X";
    corner.title = corner.textContent;
    headerRow.appendChild(corner);

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const th = document.createElement("th");
      th.className = "artify-xyz-col-head";
      th.textContent = `X=${String(data.result[ix]?.value ?? `x${ix}`)}`;
      th.title = th.textContent;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
  }

  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (let iy = 0; iy < axes.yCount; iy += 1) {
    const tr = document.createElement("tr");

    const yLabel = document.createElement("th");
    yLabel.className = "artify-xyz-y-col-head";
    yLabel.textContent = `Y=${String(data.result[0]?.children?.[iy]?.value ?? `y${iy}`)}`;
    yLabel.title = yLabel.textContent;
    tr.appendChild(yLabel);

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const xNode = data?.result?.[ix];
      const yNode = xNode?.children?.[iy];
      const cell = Array.isArray(yNode?.children) ? yNode.children : [];
      const cellHasZAxis = cell.length > 0 && cell[0]?.type === "axis";

      if (cellHasZAxis) {
        for (let iz = 0; iz < axes.zCount; iz += 1) {
          const td = document.createElement("td");
          td.className = "artify-xyz-img-td";
          const zNode = cell[iz];
          const zImages = Array.isArray(zNode?.children) ? zNode.children : [];
          const entry = zImages[Math.min(Math.max(batchIndex, 0), Math.max(0, zImages.length - 1))] || zImages[0] || null;
          const src = resolveImageSrc(node, entry);
          if (src) {
            const img = document.createElement("img");
            img.className = "artify-xyz-cell";
            img.loading = "lazy";
            img.src = src;
            img.alt = getImageFilename(entry) || `${ix},${iy},${iz}`;
            td.appendChild(img);
          } else {
            const missing = document.createElement("div");
            missing.className = "artify-xyz-missing";
            missing.textContent = "Missing";
            td.appendChild(missing);
          }
          tr.appendChild(td);
        }
      } else {
        const td = document.createElement("td");
        td.className = "artify-xyz-img-td";
        const entry = cell[Math.min(Math.max(batchIndex, 0), Math.max(0, cell.length - 1))] || cell[0] || null;
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
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  content.appendChild(wrap);
}

function renderCurrentView(node) {
  if (node?.artifyRootEl) {
    const cellSize = getAutoCellSize(node);
    node.artifyRootEl.style.setProperty("--artify-cell-size", `${cellSize}px`);
  }
  renderLegend(node);

  if (node?.artifyViewMode === "matrix" && node?.artifyGridData) {
    renderMatrixGrid(node, node.artifyGridData);
  } else {
    renderFlatGrid(node, node?.artifyFlatImages || []);
  }
}

function sanitizeExportBaseName(value) {
  const raw = String(value || "").trim();
  const fallback = "artify_xyz_grid";
  const safe = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "_");
  return safe || fallback;
}

function ellipsizeText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (!value) return "";
  if (ctx.measureText(value).width <= maxWidth) return value;

  const suffix = "...";
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = value.slice(0, mid) + suffix;
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return value.slice(0, lo) + suffix;
}

function wrapLegendLines(ctx, legendParts, maxWidth) {
  const chunks = (legendParts || []).map((part) => `${part.axis}=${part.text}`);
  if (!chunks.length) return [];

  const lines = [];
  let line = "";
  for (const chunk of chunks) {
    const candidate = line ? `${line}    ${chunk}` : chunk;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function loadImageForCanvas(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function loadImageMapForSources(sources) {
  const uniqueSources = Array.from(new Set((sources || []).filter(Boolean)));
  const out = new Map();
  if (!uniqueSources.length) return out;

  await Promise.all(
    uniqueSources.map(async (src) => {
      out.set(src, await loadImageForCanvas(src));
    }),
  );
  return out;
}

function drawImageNative(ctx, image, x, y, width, height) {
  if (!image || !image.width || !image.height) return;

  const drawW = image.width;
  const drawH = image.height;
  const dx = x + (width - drawW) / 2;
  const dy = y + (height - drawH) / 2;

  ctx.drawImage(image, dx, dy, drawW, drawH);
}

function buildAxisOffsets(sizes, start = 0) {
  const offsets = [];
  let acc = start;
  for (const size of sizes) {
    offsets.push(acc);
    acc += size;
  }
  return offsets;
}

async function buildMatrixExportCanvas(node) {
  const data = node?.artifyGridData;
  const axes = getAxesInfo(data);
  if (!data || axes.xCount < 1 || axes.yCount < 1) {
    throw new Error("No matrix grid data available.");
  }

  const hasZAxis = axes.hasZAxis;
  const imageColCount = axes.xCount * (hasZAxis ? axes.zCount : 1);
  const batchIndex = 0;
  const yColWidth = Y_LABEL_COL_WIDTH;
  const defaultMissingCellSize = 128;

  const cellEntries = [];
  for (let iy = 0; iy < axes.yCount; iy += 1) {
    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const xNode = data?.result?.[ix];
      const yNode = xNode?.children?.[iy];
      const cell = Array.isArray(yNode?.children) ? yNode.children : [];
      const cellHasZAxis = cell.length > 0 && cell[0]?.type === "axis";

      if (cellHasZAxis) {
        for (let iz = 0; iz < axes.zCount; iz += 1) {
          const zNode = cell[iz];
          const zImages = Array.isArray(zNode?.children) ? zNode.children : [];
          const entry = zImages[Math.min(Math.max(batchIndex, 0), Math.max(0, zImages.length - 1))] || zImages[0] || null;
          cellEntries.push({
            row: iy,
            col: ix * axes.zCount + iz,
            src: resolveImageSrc(node, entry),
          });
        }
      } else {
        const entry = cell[Math.min(Math.max(batchIndex, 0), Math.max(0, cell.length - 1))] || cell[0] || null;
        cellEntries.push({
          row: iy,
          col: ix,
          src: resolveImageSrc(node, entry),
        });
      }
    }
  }

  const imageMap = await loadImageMapForSources(cellEntries.map((entry) => entry.src));
  const cellByKey = new Map(cellEntries.map((entry) => [`${entry.row}:${entry.col}`, entry]));
  const colWidths = Array.from({ length: imageColCount }, () => defaultMissingCellSize);
  const rowHeights = Array.from({ length: axes.yCount }, () => defaultMissingCellSize);

  for (let row = 0; row < axes.yCount; row += 1) {
    for (let col = 0; col < imageColCount; col += 1) {
      const cell = cellByKey.get(`${row}:${col}`);
      const image = imageMap.get(cell?.src || "") || null;
      if (!image || !image.width || !image.height) continue;
      colWidths[col] = Math.max(colWidths[col], image.width);
      rowHeights[row] = Math.max(rowHeights[row], image.height);
    }
  }

  const colOffsets = buildAxisOffsets(colWidths, yColWidth);
  const rowOffsets = buildAxisOffsets(rowHeights, 0);
  const bodyWidth = colWidths.reduce((sum, value) => sum + value, 0);
  const bodyHeight = rowHeights.reduce((sum, value) => sum + value, 0);

  const pad = 12;
  const legendPadBottom = 8;
  const headH1 = 26;
  const headH2 = hasZAxis ? 24 : 0;
  const headTotalH = headH1 + headH2;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = "12px sans-serif";
  const legendParts = collectLegendParts(data);
  const tableWidth = yColWidth + bodyWidth;
  const legendLines = wrapLegendLines(measureCtx, legendParts, Math.max(200, tableWidth));
  const legendLineH = 16;
  const legendHeight = legendLines.length ? legendLines.length * legendLineH + 2 : 0;

  const tableHeight = headTotalH + bodyHeight;
  const canvas = document.createElement("canvas");
  canvas.width = pad * 2 + tableWidth;
  canvas.height = pad * 2 + legendHeight + (legendHeight ? legendPadBottom : 0) + tableHeight;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1f1f1f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#b8b8b8";
  for (let i = 0; i < legendLines.length; i += 1) {
    ctx.fillText(legendLines[i], pad, pad + 12 + i * legendLineH);
  }

  const tableX = pad;
  const tableY = pad + legendHeight + (legendHeight ? legendPadBottom : 0);
  const headerBg = "#2d2d2d";
  const headerText = "#d3d3d3";
  const cellBg = "#262626";
  const borderColor = "#4a4a4a";
  const missingBg = "#1d1d1d";
  const missingText = "#9a9a9a";

  const drawCellBox = (x, y, w, h, bg) => {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };

  const drawCenterText = (text, x, y, w, h, maxWidth = w - 8) => {
    ctx.fillStyle = headerText;
    const value = ellipsizeText(ctx, text, Math.max(10, maxWidth));
    const metrics = ctx.measureText(value);
    const tx = x + (w - metrics.width) / 2;
    const ty = y + h / 2 + 4;
    ctx.fillText(value, tx, ty);
  };

  if (hasZAxis) {
    drawCellBox(tableX, tableY, yColWidth, headTotalH, headerBg);
    drawCenterText("Y \\ X/Z", tableX, tableY, yColWidth, headTotalH, yColWidth - 10);

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const startCol = ix * axes.zCount;
      const x = tableX + colOffsets[startCol];
      let w = 0;
      for (let iz = 0; iz < axes.zCount; iz += 1) {
        w += colWidths[startCol + iz] || defaultMissingCellSize;
      }
      drawCellBox(x, tableY, w, headH1, headerBg);
      drawCenterText(`X=${String(data.result[ix]?.value ?? `x${ix}`)}`, x, tableY, w, headH1, w - 10);
    }

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const firstCell = data.result[ix]?.children?.[0]?.children || [];
      for (let iz = 0; iz < axes.zCount; iz += 1) {
        const col = ix * axes.zCount + iz;
        const x = tableX + colOffsets[col];
        const w = colWidths[col] || defaultMissingCellSize;
        const zNode = firstCell[iz];
        drawCellBox(x, tableY + headH1, w, headH2, headerBg);
        drawCenterText(`Z=${String(zNode?.value ?? `z${iz}`)}`, x, tableY + headH1, w, headH2, w - 8);
      }
    }
  } else {
    drawCellBox(tableX, tableY, yColWidth, headH1, headerBg);
    drawCenterText("Y \\ X", tableX, tableY, yColWidth, headH1, yColWidth - 10);

    for (let ix = 0; ix < axes.xCount; ix += 1) {
      const x = tableX + colOffsets[ix];
      const w = colWidths[ix] || defaultMissingCellSize;
      drawCellBox(x, tableY, w, headH1, headerBg);
      drawCenterText(`X=${String(data.result[ix]?.value ?? `x${ix}`)}`, x, tableY, w, headH1, w - 8);
    }
  }

  ctx.font = "11px sans-serif";
  for (let iy = 0; iy < axes.yCount; iy += 1) {
    const y = tableY + headTotalH + rowOffsets[iy];
    const h = rowHeights[iy] || defaultMissingCellSize;
    drawCellBox(tableX, y, yColWidth, h, headerBg);
    drawCenterText(`Y=${String(data.result[0]?.children?.[iy]?.value ?? `y${iy}`)}`, tableX, y, yColWidth, h, yColWidth - 10);

    for (let col = 0; col < imageColCount; col += 1) {
      const x = tableX + colOffsets[col];
      const w = colWidths[col] || defaultMissingCellSize;
      drawCellBox(x, y, w, h, cellBg);

      const cell = cellByKey.get(`${iy}:${col}`);
      const image = imageMap.get(cell?.src || "") || null;
      if (image) {
        drawImageNative(ctx, image, x + 1, y + 1, w - 2, h - 2);
      } else {
        ctx.fillStyle = missingBg;
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        ctx.fillStyle = missingText;
        const missing = "Missing";
        const metrics = ctx.measureText(missing);
        ctx.fillText(missing, x + (w - metrics.width) / 2, y + h / 2 + 4);
      }
    }
  }

  return canvas;
}

async function buildFlatExportCanvas(node) {
  const images = Array.isArray(node?.artifyFlatImages) ? node.artifyFlatImages : [];
  if (!images.length) {
    throw new Error("No images loaded.");
  }

  const sources = images.map((item) => String(item?.src || "").trim()).filter(Boolean);
  const imageMap = await loadImageMapForSources(sources);

  const cols = Math.max(1, Math.ceil(Math.sqrt(images.length)));
  const rows = Math.max(1, Math.ceil(images.length / cols));
  const gap = 8;
  const pad = 12;
  const labelH = 24;
  const defaultMissingCellSize = 128;

  const colWidths = Array.from({ length: cols }, () => defaultMissingCellSize);
  const rowHeights = Array.from({ length: rows }, () => defaultMissingCellSize);
  for (let index = 0; index < images.length; index += 1) {
    const item = images[index];
    const row = Math.floor(index / cols);
    const col = index % cols;
    const src = String(item?.src || "").trim();
    const image = imageMap.get(src) || null;
    if (!image || !image.width || !image.height) continue;
    colWidths[col] = Math.max(colWidths[col], image.width);
    rowHeights[row] = Math.max(rowHeights[row], image.height);
  }

  const colOffsets = buildAxisOffsets(colWidths, 0);
  const rowOffsets = buildAxisOffsets(
    rowHeights.map((height) => height + labelH),
    0,
  );
  const bodyWidth = colWidths.reduce((sum, value) => sum + value, 0);
  const bodyHeight = rowHeights.reduce((sum, value) => sum + value + labelH, 0);

  const canvas = document.createElement("canvas");
  canvas.width = pad * 2 + bodyWidth + (cols - 1) * gap;
  canvas.height = pad * 2 + bodyHeight + (rows - 1) * gap;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1f1f1f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < images.length; index += 1) {
    const item = images[index];
    const row = Math.floor(index / cols);
    const col = index % cols;
    const cellW = colWidths[col] || defaultMissingCellSize;
    const cellH = rowHeights[row] || defaultMissingCellSize;
    const tileH = cellH + labelH;
    const x = pad + colOffsets[col] + col * gap;
    const y = pad + rowOffsets[row] + row * gap;

    ctx.fillStyle = "#262626";
    ctx.fillRect(x, y, cellW, tileH);
    ctx.strokeStyle = "#444444";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, tileH - 1);

    const src = String(item?.src || "").trim();
    const image = imageMap.get(src) || null;
    if (image) {
      drawImageNative(ctx, image, x + 1, y + 1, cellW - 2, cellH - 2);
    } else {
      ctx.fillStyle = "#1d1d1d";
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
      ctx.fillStyle = "#9a9a9a";
      ctx.font = "11px sans-serif";
      const missing = "Missing";
      const metrics = ctx.measureText(missing);
      ctx.fillText(missing, x + (cellW - metrics.width) / 2, y + cellH / 2 + 4);
    }

    ctx.fillStyle = "#262626";
    ctx.fillRect(x, y + cellH, cellW, labelH);
    ctx.fillStyle = "#bbbbbb";
    ctx.font = "11px sans-serif";
    const label = ellipsizeText(ctx, String(item?.name || ""), cellW - 10);
    ctx.fillText(label, x + 5, y + cellH + 16);
  }

  return canvas;
}

function downloadCanvasAsPng(canvas, filename) {
  return new Promise((resolve, reject) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      reject(new Error("Invalid export canvas."));
      return;
    }

    const triggerDownload = (url) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    };

    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to export grid image."));
          return;
        }
        const url = URL.createObjectURL(blob);
        triggerDownload(url);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }, "image/png");
      return;
    }

    try {
      triggerDownload(canvas.toDataURL("image/png"));
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function exportCurrentGridImage(node) {
  if (!node) return;

  try {
    setStatus(node, "Exporting grid image...");
    const canvas =
      node.artifyViewMode === "matrix" && node.artifyGridData ? await buildMatrixExportCanvas(node) : await buildFlatExportCanvas(node);
    const folderPart = sanitizeExportBaseName(getActiveFolderName(node) || "artify_xyz_grid");
    const filename = `${folderPart}_grid.png`;
    await downloadCanvasAsPng(canvas, filename);

    if (node.artifyViewMode === "matrix" && node.artifyGridData) {
      setStatus(node, `${statusForMatrix(node, node.artifyLoadedFolder || "selected folder")} | Exported ${filename}`);
    } else {
      const count = node?.artifyFlatImages?.length || 0;
      setStatus(node, `${node.artifyLoadedFolder || "selected folder"} (${count} image${count === 1 ? "" : "s"}) | Exported ${filename}`);
    }
  } catch (error) {
    console.error("[ArtifyXYZViewer] Failed to export grid image:", error);
    setStatus(node, "Failed to export grid image.");
  }
}

function statusForMatrix(node, folderLabel) {
  const axes = getAxesInfo(node.artifyGridData);
  const zText = axes.hasZAxis ? `, z=all(${axes.zCount})` : "";
  return `${folderLabel} (${axes.xCount} x ${axes.yCount}${zText})`;
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
    setStatus(node, "Use Load Folder.");
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

  const legend = document.createElement("div");
  legend.className = "artify-xyz-legend";
  legend.style.display = "none";

  const content = document.createElement("div");
  content.className = "artify-xyz-content";

  const empty = document.createElement("div");
  empty.className = "artify-xyz-empty";
  empty.textContent = "No images loaded.";
  content.appendChild(empty);

  root.appendChild(status);
  root.appendChild(legend);
  root.appendChild(content);

  return { root, status, legend, content };
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
      this._artifyResizeRaf = null;

      if (!this.artifyDomWidget) {
        const { root, status, legend, content } = createViewerContainer();
        this.artifyRootEl = root;
        this.artifyStatusEl = status;
        this.artifyLegendEl = legend;
        this.artifyContentEl = content;

        this.artifyDomWidget = this.addDOMWidget("xyz_grid", "custom", root, {
          serialize: false,
          hideOnZoom: false,
        });

        this.artifyDomWidget.computeSize = (width) => [Math.max(500, width), 440];
      }

      if (!this.artifyResizeObserver && typeof ResizeObserver !== "undefined") {
        this.artifyResizeObserver = new ResizeObserver(() => {
          if (this._artifyResizeRaf != null) {
            cancelAnimationFrame(this._artifyResizeRaf);
          }
          this._artifyResizeRaf = requestAnimationFrame(() => {
            renderCurrentView(this);
            if (this.artifyViewMode === "matrix" && this.artifyGridData) {
              setStatus(this, statusForMatrix(this, this.artifyLoadedFolder || "selected folder"));
            }
          });
        });
        this.artifyResizeObserver.observe(this.artifyRootEl);
      }

      if (!this.widgets?.some((widget) => widget.name === "Load Folder")) {
        this.addWidget("button", "Load Folder", "", () => {
          void promptForFolder(this);
        });
      }

      if (!this.widgets?.some((widget) => widget.name === "Export Grid Image")) {
        this.addWidget("button", "Export Grid Image", "", () => {
          void exportCurrentGridImage(this);
        });
      }

      const size = this.computeSize();
      this.setSize([Math.max(size[0], 760), Math.max(size[1], 620)]);
      return result;
    };

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = originalOnExecuted?.apply(this, arguments);

      const folderFromUi = String(message?.plot_folder?.[0] || "").trim();
      if (folderFromUi) {
        this.artifyLoadedFolder = folderFromUi;
        void loadServerFolder(this, folderFromUi);
      }

      return result;
    };

    const originalOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this.artifyResizeObserver) {
        this.artifyResizeObserver.disconnect();
        this.artifyResizeObserver = null;
      }
      if (this._artifyResizeRaf != null) {
        cancelAnimationFrame(this._artifyResizeRaf);
        this._artifyResizeRaf = null;
      }
      revokeObjectUrls(this);
      return originalOnRemoved?.apply(this, arguments);
    };
  },
});
