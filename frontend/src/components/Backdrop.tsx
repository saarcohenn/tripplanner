/**
 * Ambient desktop artwork: a bamboo grove down the right edge and a Korea/Japan-flavoured
 * skyline along the bottom — the two motifs this planner was built around.
 *
 * Drawn inline rather than shipped as an image so it costs no request, stays sharp at any
 * width, and recolours itself from the theme tokens (see .backdrop* in styles.css) instead
 * of needing a separate dark-mode asset. It's decorative only: aria-hidden, pointer-events
 * none, and hidden outright on phones where there's no room for it.
 */
export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      {/* Skyline — three depth layers, each further back being paler and shorter. */}
      <svg className="backdrop-city" viewBox="0 0 1200 260" preserveAspectRatio="xMidYEnd slice">
        {/* far layer */}
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

        {/* mid layer */}
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
          <rect x="1170" y="200" width="40" height="60" />
        </g>

        {/* near layer — darkest, tallest, closest to the reader */}
        <g className="city-near">
          <rect x="20" y="224" width="80" height="36" />
          <rect x="140" y="214" width="64" height="46" />
          <rect x="330" y="220" width="92" height="40" />
          <rect x="540" y="212" width="70" height="48" />
          <rect x="690" y="226" width="86" height="34" />
          <rect x="900" y="216" width="74" height="44" />
          <rect x="1080" y="222" width="90" height="38" />
        </g>
      </svg>

      {/* Bamboo grove hugging the left gutter. */}
      <svg className="backdrop-bamboo" viewBox="0 0 200 700" preserveAspectRatio="xMaxYMid slice">
        <g className="bamboo-far">
          <Stalk x={26} width={11} segments={7} />
          <Stalk x={92} width={9} segments={8} />
          <Stalk x={150} width={10} segments={7} />
        </g>
        <g className="bamboo-near">
          <Stalk x={56} width={16} segments={6} leaves />
          <Stalk x={120} width={14} segments={6} leaves />
        </g>
      </svg>
    </div>
  );
}

/** One bamboo culm: a column split into segments by node lines, optionally with leaves. */
function Stalk({ x, width, segments, leaves = false }: {
  x: number; width: number; segments: number; leaves?: boolean;
}) {
  const segH = 700 / segments;
  const nodes = Array.from({ length: segments - 1 }, (_, i) => (i + 1) * segH);
  return (
    <g>
      <rect x={x} y={-10} width={width} height={720} rx={width / 2.6} />
      {nodes.map((y) => (
        <rect key={y} className="bamboo-node" x={x - 2} y={y - 3} width={width + 4} height={6} rx={3} />
      ))}
      {leaves && nodes.slice(0, 3).map((y, i) => (
        <g key={y} className="bamboo-leaf">
          {/* alternate which side each leaf pair sprouts from */}
          <ellipse
            cx={i % 2 === 0 ? x + width + 26 : x - 26}
            cy={y - 16} rx={30} ry={6}
            transform={`rotate(${i % 2 === 0 ? -22 : 22} ${i % 2 === 0 ? x + width + 26 : x - 26} ${y - 16})`}
          />
          <ellipse
            cx={i % 2 === 0 ? x + width + 18 : x - 18}
            cy={y + 6} rx={22} ry={5}
            transform={`rotate(${i % 2 === 0 ? -8 : 8} ${i % 2 === 0 ? x + width + 18 : x - 18} ${y + 6})`}
          />
        </g>
      ))}
    </g>
  );
}
