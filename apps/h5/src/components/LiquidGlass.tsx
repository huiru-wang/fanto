import { useEffect, useState } from "react";
import { ShaderDisplacementGenerator, fragmentShaders } from "./liquid-glass/shader-utils";

// Background-only refraction follows liquid-glass-react. Foreground stays sharp.
// A shared, bounded map avoids generating a full-size canvas on every keystroke.
let displacementMap = "";
export function LiquidGlassFilters() {
  const [map, setMap] = useState(displacementMap);
  useEffect(() => {
    if (!displacementMap) {
      try {
        const generator = new ShaderDisplacementGenerator({ width: 256, height: 128, fragment: fragmentShaders.liquidGlass });
        displacementMap = generator.updateShader();
        generator.destroy();
      } catch { return; } // CSS blur and highlights remain when canvas is unavailable.
    }
    setMap(displacementMap);
  }, []);
  return <svg className="liquid-glass-definitions" aria-hidden="true" focusable="false">
    <defs><filter id="fanto-glass-refraction" x="-20%" y="-40%" width="140%" height="180%" colorInterpolationFilters="sRGB">
      {map && <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />}
      {map && <feDisplacementMap in="SourceGraphic" in2="map" scale="16" xChannelSelector="R" yChannelSelector="B" />}
    </filter></defs>
  </svg>;
}

export function LiquidGlassLayer() {
  return <span className="liquid-glass-layer" aria-hidden="true"><span className="liquid-glass-warp" /></span>;
}
