import { app } from "/scripts/app.js";

const NODE_ID = "ArtifySelectInputs";
const SPLITTER = "::";

function getGraphInputs(graph) {
  const inputs = [];
  graph?._nodes?.forEach((node) => {
    node.widgets?.forEach((widget) => {
      if (!widget?.name) return;
      if (widget.type === "button") return;
      inputs.push([`#${node.id}`, node.title || node.comfyClass || "Node", widget.name].join(SPLITTER));
    });
  });
  return inputs;
}

function refreshPreview(node) {
  const values = [];
  node.widgets?.forEach((widget) => {
    if (widget.type !== "combo") return;
    if (!widget.name?.startsWith("input_")) return;

    const value = String(widget.value || "");
    const parts = value.split(SPLITTER);
    if (parts.length !== 3) return;

    values.push({
      node_id: parts[0].startsWith("#") ? parts[0].slice(1) : parts[0],
      node_title: parts[1],
      widget_name: parts[2],
    });
  });

  const preview = node.widgets?.find((widget) => widget.name === "preview");
  if (preview) {
    preview.value = JSON.stringify(values, null, 2);
  }
}

function refreshInputs(node, appRef) {
  const inputs = getGraphInputs(appRef.graph);
  const values = inputs.length ? inputs : ["none"];

  let comboIndex = -1;
  for (const widget of node.widgets || []) {
    if (widget.type !== "combo") continue;

    comboIndex += 1;
    widget.options.values = values;

    const currentValue = node.widgets_values?.[comboIndex];
    if (currentValue && values.includes(currentValue)) {
      widget.value = currentValue;
    } else if (!values.includes(widget.value)) {
      widget.value = values[0];
    }
  }

  const size = node.computeSize();
  node.setSize([Math.max(380, size[0] * 1.2), size[1]]);
  refreshPreview(node);
}

app.registerExtension({
  name: "ArtifyTesting.SelectInputs",
  nodeCreated(node, appRef) {
    if (node.comfyClass !== NODE_ID && node.type !== NODE_ID) return;

    node.widgets?.forEach((widget) => {
      if (widget.name === "preview" && widget.element) {
        widget.element.disabled = true;
      }

      if (widget.type === "combo" && widget.name?.startsWith("input_")) {
        const original = widget.callback;
        widget.callback = function (...args) {
          const result = original?.apply(this, args);
          refreshPreview(node);
          return result;
        };
      }
    });

    node.addWidget("button", "Refresh", "", () => refreshInputs(node, appRef));
    refreshInputs(node, appRef);
  },
  loadedGraphNode(node, appRef) {
    if (node.comfyClass !== NODE_ID && node.type !== NODE_ID) return;
    refreshInputs(node, appRef);
  },
});
