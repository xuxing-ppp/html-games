(function initializeVisualProperties(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVisualPropertiesApi() {
  "use strict";

  // A sampler, not a scheduler: consumers supply their own normalized lifetime.
  function createVisualPropertyAnimation(schema, options = {}) {
    const label = options.label || "visual-properties";
    const fail = (message) => { throw new TypeError(`${label}: ${message}`); };
    const isRecord = (value) => value && typeof value === "object" &&
      !Array.isArray(value) && typeof value.then !== "function";
    if (!isRecord(schema)) fail("schema must be an object");
    const supplied = options.properties === undefined ? {} : options.properties;
    const defaults = options.defaultProperties === undefined ? {} : options.defaultProperties;
    if (!isRecord(supplied) || !isRecord(defaults)) fail("properties must be an object");
    const properties = { ...defaults, ...supplied };
    const names = Object.keys(schema);
    const allowed = new Set(names);
    for (const name of Object.keys(properties)) {
      if (!allowed.has(name)) fail(`unsupported property ${name}`);
    }
    const tracks = names.map((name) => {
      const spec = { ...schema[name] };
      if (spec.type !== "number" && spec.type !== "color") fail(`${name}: invalid type`);
      if (spec.type === "number" && (
        (spec.min !== undefined && !Number.isFinite(spec.min)) ||
        (spec.max !== undefined && !Number.isFinite(spec.max)) ||
        (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max)
      )) fail(`${name}: invalid range`);
      const validate = (value) => {
        if (spec.type === "number") {
          if (!Number.isFinite(value) || (spec.min !== undefined && value < spec.min) ||
              (spec.max !== undefined && value > spec.max)) fail(`${name}: invalid numeric value`);
        } else if (typeof value !== "string" || !value.trim()) {
          fail(`${name}: expected a CSS color string`);
        }
        return value;
      };
      const input = properties[name] === undefined ? {} : properties[name];
      if (!isRecord(input)) fail(`${name}: expected a property descriptor`);
      for (const key of Object.keys(input)) {
        if (!["value", "overLife", "combine"].includes(key)) fail(`${name}: unsupported option ${key}`);
      }
      const base = input.value === undefined ? spec.default : input.value;
      if (base !== undefined) validate(base);
      const combine = input.combine === undefined ? "replace" : input.combine;
      if (!["replace", "multiply"].includes(combine) ||
          (combine === "multiply" && (spec.type !== "number" || base === undefined))) {
        fail(`${name}: invalid combine policy`);
      }
      let stops = null;
      if (input.overLife !== undefined) {
        if (!Array.isArray(input.overLife) || input.overLife.length < 2) fail(`${name}: curve requires two stops`);
        stops = input.overLife.map((stop) => {
          if (!isRecord(stop) || !Number.isFinite(stop.at) || stop.at < 0 || stop.at > 1) {
            fail(`${name}: invalid curve position`);
          }
          let value = validate(stop.value);
          if (spec.type === "color") {
            if (!/^#[0-9a-f]{6}$/i.test(value)) fail(`${name}: color curves require #rrggbb`);
            value = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
          }
          return { at: stop.at, value };
        });
        if (stops[0].at !== 0 || stops[stops.length - 1].at !== 1 ||
            stops.some((stop, index) => index > 0 && stop.at <= stops[index - 1].at)) {
          fail(`${name}: curve must strictly increase from 0 to 1`);
        }
      }
      return { name, type: spec.type, base, validate, combine, stops };
    });
    let mapper = options.mapProperties;
    let metadata = options.metadata;
    const follow = options.followMetadata === undefined ? false : options.followMetadata;
    if (typeof follow !== "boolean" || (mapper !== undefined && typeof mapper !== "function") ||
        (follow && !mapper)) fail("metadata mapping requires a function and boolean followMetadata");
    let resolved = tracks.map((track) => track.base);
    function refresh() {
      if (!mapper) return;
      const values = mapper(metadata);
      if (!isRecord(values)) fail("metadata mapping must synchronously return an object");
      for (const key of Object.keys(values)) {
        if (!allowed.has(key)) fail(`unsupported mapped property ${key}`);
      }
      // Validate atomically; a failing callback cannot partially update appearance.
      resolved = tracks.map((track) => values[track.name] === undefined
        ? track.base : track.validate(values[track.name]));
    }
    refresh();
    if (!follow) { mapper = undefined; metadata = undefined; }
    return Object.freeze({
      updateMetadata() { if (follow) refresh(); },
      sample(progress, output = {}) {
        if (!Number.isFinite(progress)) fail("progress must be finite");
        const t = Math.max(0, Math.min(1, progress));
        tracks.forEach((track, index) => {
          let value = resolved[index];
          if (track.stops) {
            let i = 1;
            while (i < track.stops.length - 1 && t > track.stops[i].at) i += 1;
            const left = track.stops[i - 1];
            const right = track.stops[i];
            const ratio = (t - left.at) / (right.at - left.at);
            const sampled = track.type === "number"
              ? left.value + (right.value - left.value) * ratio
              : "#" + left.value.map((channel, j) => Math.round(
                channel + (right.value[j] - channel) * ratio
              ).toString(16).padStart(2, "0")).join("");
            value = track.combine === "multiply" ? value * sampled : sampled;
          }
          if (value !== undefined) track.validate(value);
          output[track.name] = value;
        });
        return output;
      }
    });
  }

  return { createVisualPropertyAnimation };
});
