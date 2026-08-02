/**
 * Booking-provider marks, drawn monochrome in currentColor so they sit with the rest of the
 * app's outlined iconography and work in both themes.
 *
 * Sources, so the next person knows what is and isn't the real thing:
 *  - Airbnb, Booking.com — the actual logos, from Simple Icons (the collection is CC0; the
 *    trademarks remain each brand's own, used here only to link to that brand).
 *  - Google — the actual G, from SVG Repo.
 *  - Skyscanner, Expedia — line-art interpretations from icon packs on SVG Repo, not the
 *    brands' own logos. Their real marks are solid, so an outlined version can only ever be
 *    an interpretation.
 *  - Agoda — ours. See the note on AgodaMark: their brand guidelines forbid what every other
 *    mark here has had done to it.
 *
 * Each takes the drawn size in px and inherits colour from its parent.
 */

type Props = { size?: number };

/** Airbnb's Bélo. Solid by design — there is no outlined version of this logo. */
export function AirbnbMark({ size = 18 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z" />
    </svg>
  );
}

/**
 * Booking.com's "B." — the glyph only. The source draws it knocked out of a filled square,
 * which at this size reads as a solid block rather than a logo, so the square is dropped.
 */
export function BookingMark({ size = 18 }: Props) {
  // viewBox is cropped to the glyph — with the square dropped it filled half the 24 box.
  return (
    <svg width={size} height={size} viewBox="6 5.5 14 14" fill="currentColor" aria-hidden="true">
      <path d="M8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z" />
    </svg>
  );
}

/** Google's G. The source nests two translates; they're folded into one here. */
export function GoogleMark({ size = 18 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <g transform="translate(-244 -7239)">
        <path d="M263.821537,7247.00386 L254.211298,7247.00386 C254.211298,7248.0033 254.211298,7250.00218 254.205172,7251.00161 L259.774046,7251.00161 C259.560644,7252.00105 258.804036,7253.40026 257.734984,7254.10487 C257.733963,7254.10387 257.732942,7254.11086 257.7309,7254.10986 C256.309581,7255.04834 254.43389,7255.26122 253.041161,7254.98137 C250.85813,7254.54762 249.130492,7252.96451 248.429023,7250.95364 C248.433107,7250.95064 248.43617,7250.92266 248.439233,7250.92066 C248.000176,7249.67336 248.000176,7248.0033 248.439233,7247.00386 L248.438212,7247.00386 C249.003881,7245.1669 250.783592,7243.49084 252.969687,7243.0321 C254.727956,7242.65931 256.71188,7243.06308 258.170978,7244.42831 C258.36498,7244.23842 260.856372,7241.80579 261.043226,7241.6079 C256.0584,7237.09344 248.076756,7238.68155 245.090149,7244.51127 L245.089128,7244.51127 C245.089128,7244.51127 245.090149,7244.51127 245.084023,7244.52226 L245.084023,7244.52226 C243.606545,7247.38565 243.667809,7250.75975 245.094233,7253.48622 C245.090149,7253.48921 245.087086,7253.49121 245.084023,7253.49421 C246.376687,7256.0028 248.729215,7257.92672 251.563684,7258.6593 C254.574796,7259.44886 258.406843,7258.90916 260.973794,7256.58747 C260.974815,7256.58847 260.975836,7256.58947 260.976857,7256.59047 C263.15172,7254.63157 264.505648,7251.29445 263.821537,7247.00386" />
      </g>
    </svg>
  );
}

/** Skyscanner, as line art. Stroke weight is the source's, which reads correctly at 18px. */
export function SkyscannerMark({ size = 18 }: Props) {
  // viewBox is cropped to the ink, which sits in the lower two-thirds of the source's 192
  // box — uncropped this reads noticeably smaller than the other five.
  return (
    <svg
      width={size} height={size} viewBox="12 12 168 168" fill="none" stroke="currentColor"
      strokeWidth={12} strokeLinecap="round" strokeMiterlimit={10} aria-hidden="true"
    >
      <path d="M96 53.16v27.26m36.68-17.65-13.64 23.61m40.7 3.45-23.62 13.63m-76.8-40.69 13.64 23.61m-40.7 3.45 23.62 13.63M22 135a305.76 305.76 0 0 1 148 0" />
      <path d="M76.53 127.16 96 138.84l19.47-11.68" strokeLinejoin="round" />
    </svg>
  );
}

/** Expedia, as line art. The source's hairline stroke vanishes at this size, so it's thickened. */
export function ExpediaMark({ size = 18 }: Props) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor"
      strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M4.6427,33.354A21.499,21.499,0,0,1,41.6511,11.7264M43.42,14.7781A21.4984,21.4984,0,0,1,6.1622,35.9992" />
      <path d="M41.65,11.7264,30.9469,16.9811,15.86,9.435,13.2735,10.84l10.183,8.177,1.1289,1.5722L19.0832,23.73,4.6427,33.354M43.42,14.7781l-9.9156,6.7227-.9456,16.852-2.6337,1.3848L28.0341,26.87l-.8108-1.7228-5.8087,3.3782L6.1633,35.9992" />
    </svg>
  );
}

/**
 * Agoda — deliberately NOT their logo.
 *
 * Their published guidelines say the logo may not be modified "in any way… including
 * rotating, editing, accessorizing, or recoloring", which is exactly what every other mark
 * on this row has had done to it to make it monochrome line art. Rather than ship a
 * knowingly non-compliant version, or drop a full-colour wordmark into a row of outlined
 * glyphs, this is a neutral placeholder in the app's own style: their initial in the
 * rounded square their app icon uses.
 *
 * If you'd rather show the real logo, the compliant route is the unmodified full-colour
 * asset from agoda.com/press/agoda-logo-guidelines — which means letting this one link look
 * different from the other five.
 */
export function AgodaMark({ size = 18 }: Props) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
      <path d="M14.2 9.6v4.9" />
      <path d="M14.2 12.05a2.45 2.45 0 1 1-2.45-2.45 2.45 2.45 0 0 1 2.45 2.45Z" />
      <path d="M9.3 16.4h5.6" strokeWidth={1.5} opacity={0.55} />
    </svg>
  );
}
