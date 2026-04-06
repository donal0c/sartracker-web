import { TILE_SOURCES, BASEMAP_IDS } from './tile-sources';

interface BasemapSwitcherProps {
  selected: string;
  onSelect: (id: string) => void;
}

export default function BasemapSwitcher({ selected, onSelect }: BasemapSwitcherProps) {
  return (
    <div
      data-testid="basemap-switcher"
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1,
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 6,
        padding: '6px 4px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
      }}
    >
      {BASEMAP_IDS.map((id) => (
        <button
          key={id}
          data-testid={`basemap-btn-${id}`}
          onClick={() => onSelect(id)}
          style={{
            background: id === selected ? '#2563eb' : 'transparent',
            color: id === selected ? '#fff' : '#333',
            border: 'none',
            borderRadius: 4,
            padding: '5px 10px',
            cursor: 'pointer',
            textAlign: 'left',
            fontWeight: id === selected ? 600 : 400,
          }}
        >
          {TILE_SOURCES[id].name}
        </button>
      ))}
    </div>
  );
}
