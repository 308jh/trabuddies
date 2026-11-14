import { useEffect } from 'react'
import { LAND_PATH, CITIES, ROUTES, MAP_W, MAP_H } from './mapData'

// a small airplane seen from above, nose pointing right (+x)
const PLANE =
  'M10 0L6 -1.3L1 -1.6L-4 -8.5L-6.4 -8.5L-4.4 -1.7L-8 -1.3L-9.4 -4.2L-11 -4.2L-9.8 0L-11 4.2L-9.4 4.2L-8 1.3L-4.4 1.7L-6.4 8.5L-4 8.5L1 1.6L6 1.3Z'

export default function Background() {
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const root = document.documentElement.style
      root.setProperty('--mx', String(e.clientX / window.innerWidth))
      root.setProperty('--my', String(e.clientY / window.innerHeight))
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

  const view = `0 0 ${MAP_W} ${MAP_H}`

  return (
    <div className="bg" aria-hidden="true">
      {/* layer 1: the dotted map, routes, cities and planes */}
      <svg className="map" viewBox={view} preserveAspectRatio="xMidYMid slice">
        <defs>
          <path id="land" d={LAND_PATH} />
          <linearGradient
            id="routeGrad"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={MAP_W}
            y2="0"
          >
            <stop offset="0" stopColor="#4cc9f0" />
            <stop offset="0.55" stopColor="#8b8cf5" />
            <stop offset="1" stopColor="#f72585" />
          </linearGradient>
        </defs>

        <use href="#land" className="land" />

        {ROUTES.map((r, i) => (
          <path key={i} id={`route-${i}`} d={r.d} className="route" />
        ))}

        {CITIES.map((c, i) => (
          <g key={c.name}>
            <circle cx={c.x} cy={c.y} r="1.6" className="city" />
            <circle
              cx={c.x}
              cy={c.y}
              r="3"
              className="ring"
              style={{ animationDelay: `${-i * 0.7}s` }}
            />
          </g>
        ))}

        {ROUTES.flatMap((r, i) =>
          r.begins.map((begin, p) => (
            <g key={`${i}-${p}`} className="plane">
              <animateMotion
                dur={`${r.dur}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
                rotate="auto"
              >
                <mpath href={`#route-${i}`} />
              </animateMotion>
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.07;0.93;1"
                dur={`${r.dur}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
              />
              <path d={PLANE} transform="scale(0.55)" />
            </g>
          ))
        )}
      </svg>

      {/* layer 2: the same map in cyan, only visible around the mouse */}
      <svg className="map lit" viewBox={view} preserveAspectRatio="xMidYMid slice">
        <use href="#land" className="land-lit" />
      </svg>
    </div>
  )
}
