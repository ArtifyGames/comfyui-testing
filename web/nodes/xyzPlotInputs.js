import { app } from "/scripts/app.js";

const NODE_ID = "ArtifyXYZPlot";
const SPLITTER = "::";
const AXIS_WIDGETS = new Set(["input_x", "input_y", "input_z"]);
const NONE_OPTION = "none";
const WIDGET_ORDER = ["output_folder_name", "input_x", "value_x", "input_y", "value_y", "input_z", "value_z"];

function isPlotNode(node) {
  return node?.comfyClass === NODE_ID || node?.type === NODE_ID;
}

function buildInputReference(node, widget) {
  const nodeId = `#${node.id}`;
  const nodeTitle = node.title || node.comfyClass || node.type || "Node";
  return [nodeId, nodeTitle, widget.name].join(SPLITTER);
}

function getGraphInputReferences(graph, currentNodeId) {
  const refs = [];

  for (const node of graph?._nodes || []) {
    if (!node || node.id === currentNodeId) continue;

    for (const widget of node.widgets || []) {
      if (!widget?.name) continue;
      if (widget.type === "button") continue;
      refs.push(buildInputReference(node, widget));
    }
  }

  refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  return [NONE_OPTION, ...refs];
}

function pickFallbackValue(widgetName, values) {
  if (widgetName === "input_z") return NONE_OPTION;
  return values.find((value) => value !== NONE_OPTION) || NONE_OPTION;
}

function applyAxisWidgetOptions(node, values) {
  for (const widget of node.widgets || []) {
    if (widget.type !== "combo") continue;
    if (!AXIS_WIDGETS.has(widget.name)) continue;

    widget.options.values = values;
    if (!values.includes(widget.value)) {
      widget.value = pickFallbackValue(widget.name, values);
    }
  }
}

function reorderPlotWidgets(node) {
  if (!Array.isArray(node?.widgets) || node.widgets.length < 2) return;

  const order = new Map(WIDGET_ORDER.map((name, index) => [name, index]));
  const originalWidgets = node.widgets.slice();
  const indexed = originalWidgets.map((widget, index) => ({ widget, index }));

  indexed.sort((a, b) => {
    const aOrder = order.has(a.widget?.name) ? order.get(a.widget.name) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(b.widget?.name) ? order.get(b.widget.name) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.index - b.index;
  });

  const changed = indexed.some((entry, index) => entry.widget !== originalWidgets[index]);
  if (!changed) return;

  node.widgets = indexed.map((entry) => entry.widget);

  if (Array.isArray(node.widgets_values) && node.widgets_values.length === originalWidgets.length) {
    const oldValues = node.widgets_values.slice();
    node.widgets_values = indexed.map((entry) => oldValues[entry.index]);
  }
}

function refreshPlotInputs(node, appRef) {
  if (!isPlotNode(node)) return;
  reorderPlotWidgets(node);
  const values = getGraphInputReferences(appRef.graph, node.id);
  applyAxisWidgetOptions(node, values);
  node.setDirtyCanvas(true, true);
}

function refreshAllPlotNodes(appRef) {
  for (const node of appRef.graph?._nodes || []) {
    if (!isPlotNode(node)) continue;
    refreshPlotInputs(node, appRef);
  }
}

app.registerExtension({
  name: "ArtifyTesting.XYZPlotInputs",
  nodeCreated(node, appRef) {
    if (isPlotNode(node)) {
      refreshPlotInputs(node, appRef);
      return;
    }
    refreshAllPlotNodes(appRef);
  },
  loadedGraphNode(node, appRef) {
    if (isPlotNode(node)) {
      refreshPlotInputs(node, appRef);
      return;
    }
    refreshAllPlotNodes(appRef);
  },
  nodeRemoved(_node, appRef) {
    refreshAllPlotNodes(appRef);
  },
});
