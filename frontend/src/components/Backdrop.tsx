/**
 * Ambient desktop artwork: bamboo groves down both edges of the content area and a
 * Korea/Japan-flavoured skyline along the bottom — the two motifs this planner was built
 * around.
 *
 * Everything is drawn as an SVG <pattern> tiled across a full-size <rect>, so the art
 * repeats seamlessly at any width instead of stretching or cropping on ultrawide displays.
 * Inline (rather than an image file) so it costs no request, stays sharp at any size, and
 * recolours itself from the theme tokens — see .backdrop* in styles.css. Decorative only:
 * aria-hidden, pointer-events none, and hidden outright on phones.
 */
export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      {/* Skyline. Pattern is one 1200-wide "block" of city that repeats horizontally. */}
      <svg className="backdrop-city" preserveAspectRatio="none">
        <defs>
          <pattern id="tp-city" width="1200" height="260" patternUnits="userSpaceOnUse">
            <CityBlock />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tp-city)" />
      </svg>

      {/* Bamboo, one grove per side. Tilted ~5° off vertical (≈85° from horizontal) in CSS. */}
      <svg className="backdrop-bamboo left" preserveAspectRatio="none">
        <defs>
          <pattern id="tp-bamboo-l" width="200" height="700" patternUnits="userSpaceOnUse">
            <BambooBlock side="l" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tp-bamboo-l)" />
      </svg>
      <svg className="backdrop-bamboo right" preserveAspectRatio="none">
        <defs>
          <pattern id="tp-bamboo-r" width="200" height="700" patternUnits="userSpaceOnUse">
            <BambooBlock side="r" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tp-bamboo-r)" />
      </svg>
    </div>
  );
}

/** One repeat of skyline: three depth layers, each further back being paler and shorter. */
function CityBlock() {
  return (
    <>
      <g className="city-far">
        <rect x="40" y="150" width="46" height="110" />
        <rect x="96" y="176" width="34" height="84" />
        <rect x="150" y="140" width="40" height="120" />
        <rect x="240" y="164" width="52" height="96" />
        <rect x="310" y="128" width="36" height="132" />
        <rect x="366" y="170" width="44" height="90" />
        <rect x="470" y="152" width="40" height="108" />
        <rect x="530" y="180" width="56" height="80" />
        <rect x="640" y="144" width="38" height="116" />
        <rect x="700" y="172" width="48" height="88" />
        <rect x="800" y="156" width="42" height="104" />
        <rect x="860" y="184" width="36" height="76" />
        <rect x="940" y="136" width="44" height="124" />
        <rect x="1010" y="168" width="50" height="92" />
        <rect x="1090" y="150" width="40" height="110" />
      </g>

      <g className="city-mid">
        <rect x="0" y="196" width="60" height="64" />
        <rect x="72" y="172" width="44" height="88" />
        <rect x="128" y="200" width="66" height="60" />
        {/* pagoda — three tiers + finial */}
        <g transform="translate(214 150)">
          <polygon points="30,0 56,20 4,20" />
          <rect x="26" y="20" width="8" height="10" />
          <polygon points="30,26 66,48 -6,48" />
          <rect x="22" y="48" width="16" height="12" />
          <polygon points="30,56 74,82 -14,82" />
          <rect x="14" y="82" width="32" height="28" />
          <rect x="28" y="-12" width="4" height="14" />
        </g>
        <rect x="310" y="186" width="54" height="74" />
        <rect x="378" y="164" width="40" height="96" />
        {/* communications tower */}
        <g transform="translate(452 120)">
          <polygon points="12,0 20,0 30,140 -2,140" />
          <rect x="2" y="34" width="28" height="16" />
          <rect x="14" y="-16" width="4" height="18" />
        </g>
        <rect x="510" y="192" width="70" height="68" />
        <rect x="596" y="168" width="46" height="92" />
        <rect x="656" y="198" width="58" height="62" />
        <rect x="730" y="176" width="42" height="84" />
        {/* torii gate */}
        <g transform="translate(800 178)">
          <rect x="-4" y="0" width="72" height="8" />
          <rect x="2" y="14" width="60" height="6" />
          <rect x="10" y="8" width="9" height="74" />
          <rect x="45" y="8" width="9" height="74" />
        </g>
        <rect x="892" y="190" width="62" height="70" />
        <rect x="968" y="166" width="44" height="94" />
        <rect x="1028" y="196" width="68" height="64" />
        <rect x="1110" y="174" width="48" height="86" />
      </g>

      <g className="city-near">
        <rect x="20" y="224" width="80" height="36" />
        <rect x="140" y="214" width="64" height="46" />
        <rect x="330" y="220" width="92" height="40" />
        <rect x="540" y="212" width="70" height="48" />
        <rect x="690" y="226" width="86" height="34" />
        <rect x="900" y="216" width="74" height="44" />
        <rect x="1080" y="222" width="90" height="38" />
      </g>
    </>
  );
}

const TILE_H = 700;

type StalkSpec = {
  x: number; w: number; bend: number; nodes: number[];
  leafAt?: number[]; leafDir?: 1 | -1;
};

/**
 * One repeat of bamboo grove. Culms differ in thickness, how far they bow, and where their
 * node rings fall — an evenly-divided column of identical rectangles read as scaffolding
 * rather than plants. Rings sit at y=0 too, so the tile seam lands on one and the culm
 * reads as continuous.
 */
function BambooBlock({ side }: { side: "l" | "r" }) {
  const stalks: StalkSpec[] = side === "l"
    ? [
        { x: 14, w: 16, bend: 11, nodes: [0, 148, 305, 430, 566], leafAt: [148, 430], leafDir: 1 },
        { x: 70, w: 9, bend: -7, nodes: [0, 190, 352, 540], leafAt: [352], leafDir: -1 },
        { x: 122, w: 19, bend: 6, nodes: [0, 132, 288, 462, 604], leafAt: [288, 604], leafDir: 1 },
        { x: 172, w: 7, bend: -10, nodes: [0, 210, 398, 588] },
      ]
    : [
        { x: 22, w: 11, bend: -9, nodes: [0, 168, 330, 512], leafAt: [330], leafDir: -1 },
        { x: 76, w: 18, bend: 8, nodes: [0, 124, 276, 448, 620], leafAt: [124, 448], leafDir: 1 },
        { x: 134, w: 8, bend: -6, nodes: [0, 200, 376, 560], leafAt: [560], leafDir: -1 },
        { x: 178, w: 14, bend: 9, nodes: [0, 156, 320, 498, 640] },
      ];
  return <>{stalks.map((s) => <Stalk key={s.x} {...s} />)}</>;
}

/** How far the culm has bowed sideways at a given height — 0 at both seams, max mid-tile. */
function bowAt(y: number, bend: number): number {
  return bend * Math.sin((Math.PI * y) / TILE_H);
}

/**
 * One bamboo culm. Drawn as a bowed band rather than a rectangle: the outline leaves and
 * re-enters vertically at y=0 and y=700, so however far it bows in between, the tile still
 * joins seamlessly top-to-bottom.
 */
function Stalk({ x, w, bend, nodes, leafAt = [], leafDir = 1 }: StalkSpec) {
  const d = [
    `M ${x},0`,
    `C ${x},60 ${x + bend},130 ${x + bend},${TILE_H / 2}`,
    `C ${x + bend},${TILE_H - 130} ${x},${TILE_H - 60} ${x},${TILE_H}`,
    `L ${x + w},${TILE_H}`,
    `C ${x + w},${TILE_H - 60} ${x + w + bend},${TILE_H - 130} ${x + w + bend},${TILE_H / 2}`,
    `C ${x + w + bend},130 ${x + w},60 ${x + w},0`,
    "Z",
  ].join(" ");

  return (
    <g>
      <path d={d} />
      {nodes.map((y) => {
        const off = bowAt(y, bend);
        // Rings track the bow and tilt with the culm's local lean.
        const lean = (bend * Math.cos((Math.PI * y) / TILE_H) * Math.PI) / TILE_H * 40;
        return (
          <rect
            key={y} className="bamboo-node"
            x={x + off - 2.5} y={y - 3.5} width={w + 5} height={7} rx={3.5}
            transform={`rotate(${lean} ${x + off + w / 2} ${y})`}
          />
        );
      })}
      {leafAt.map((y) => (
        <Leaves key={y} y={y} x={x + bowAt(y, bend)} w={w} dir={leafDir} />
      ))}
    </g>
  );
}

/** A spray of three tapered leaves sprouting from a node, drooping at different angles. */
function Leaves({ x, y, w, dir }: { x: number; y: number; w: number; dir: 1 | -1 }) {
  const root = dir === 1 ? x + w : x;
  // length, droop angle, thickness — deliberately uneven so the spray looks grown, not stamped
  const blades: [number, number, number][] = [[46, -26, 7], [58, -4, 6], [38, 20, 5]];
  return (
    <g className="bamboo-leaf">
      {blades.map(([len, angle, thick], i) => (
        <path
          key={i}
          d={`M 0,0 Q ${len * 0.45},${-thick} ${len},0 Q ${len * 0.45},${thick} 0,0 Z`}
          transform={`translate(${root} ${y}) scale(${dir} 1) rotate(${angle})`}
        />
      ))}
    </g>
  );
}
