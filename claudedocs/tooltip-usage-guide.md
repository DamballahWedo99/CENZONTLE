# Tooltip Usage Guide - AprobacionD3Chart

## Quick Start

The tooltip functionality is **enabled by default**. No additional configuration needed!

```tsx
import { AprobacionD3Chart } from '@/components/aprobacion/chart/AprobacionD3Chart';

// Basic usage - tooltips work automatically
<AprobacionD3Chart data={monthlyData} />
```

## Configuration Options

### Enable/Disable Tooltip

```tsx
// Disable tooltip
<AprobacionD3Chart
  data={monthlyData}
  config={{
    showTooltip: false
  }}
/>

// Enable tooltip (default)
<AprobacionD3Chart
  data={monthlyData}
  config={{
    showTooltip: true
  }}
/>
```

## User Interactions

### Desktop (Mouse)
1. **Hover over any data point** (circle) to show tooltip
2. **Move cursor** - tooltip follows smoothly
3. **Move away** - tooltip disappears instantly

### Mobile (Touch)
1. **Tap on any data point** to show tooltip
2. **Tooltip persists for 2 seconds** then auto-hides
3. **Tap another point** to switch immediately

### Keyboard
1. **Tab to focus** on data points
2. **Visual focus indicator** shows current point
3. *Future: Press Enter to toggle tooltip*

## Tooltip Information

### What's Displayed

For each data point, the tooltip shows:

```
┌─────────────────────────────────┐
│ [Mes]               [●]         │ <- Month + Color indicator
├─────────────────────────────────┤
│ [Metric Label]                  │ <- Primary metric name
│ XX.XX%                          │ <- Large value in metric color
├─────────────────────────────────┤
│ Transacciones Totales    X,XXX  │
│ Transacciones Aprobadas  X,XXX  │
│ Aprobación Final        XX.XX%  │
│ ─────────────────────────────── │
│ Autenticación 3DS       XX.XX%  │
└─────────────────────────────────┘
      ◄── Arrow points to data point
```

### Positioning Logic

**Tooltip automatically positions itself:**
- **Left side of screen**: Shows to the right of cursor
- **Right side of screen**: Shows to the left of cursor
- **Top/bottom**: Adjusts vertically to stay visible
- **Arrow indicator**: Always points to the active data point

## Visual States

### Normal State (No Hover)
- Circle radius: 4px
- Stroke: white (2px)
- Fill: metric color
- No shadow

### Active State (Hovering)
- Circle radius: **6px** (grows)
- Stroke: white (2px)
- Fill: metric color
- Shadow: drop-shadow(0 0 6px rgba(0,0,0,0.3))
- Transition: 200ms smooth

## Dark/Light Mode

Tooltip automatically adapts to theme:

**Light Mode:**
- Background: White
- Border: Zinc-200
- Text: Zinc-900
- Shadow: Visible

**Dark Mode:**
- Background: Zinc-900
- Border: Zinc-800
- Text: Zinc-100
- Shadow: Softer

## Combining with Other Features

### With Month Click Handler

```tsx
<AprobacionD3Chart
  data={monthlyData}
  onMonthClick={(monthData) => {
    console.log('Month clicked:', monthData.mes);
    // Both tooltip AND click work together
  }}
/>
```

**Behavior:**
- Hover shows tooltip
- Click triggers onMonthClick callback
- Both events are independent

### With Custom Metrics

```tsx
<AprobacionD3Chart
  data={monthlyData}
  config={{
    metrics: [
      {
        key: 'aprobacionBase',
        label: 'Base Approval',
        color: 'hsl(142.1 76.2% 36.3%)',
        type: 'area'
      }
      // ... more metrics
    ]
  }}
/>
```

**Result:**
- Tooltip shows your custom metric label
- Uses your custom color for display
- All data remains accurate

## Accessibility

### Screen Reader Support

The tooltip provides rich information to screen readers:

```
Circle announced as: "Aprobación Base para Enero: 70.30%, button"
Tooltip content announced when shown (aria-live="polite")
```

### Keyboard Navigation

```
Tab → Focus first data point
Tab → Focus next point
Shift+Tab → Focus previous point
```

## Performance Considerations

### Optimized For
- **Fast hover response** - No noticeable lag
- **Smooth cursor tracking** - Updates position fluidly
- **No layout shifts** - Positioned absolutely
- **Minimal re-renders** - Only updates tooltip state

### Best Practices
- Avoid very frequent data updates while tooltip is active
- Keep data array reasonable size (<50 months)
- Use config.showTooltip={false} if tooltips aren't needed

## Troubleshooting

### Tooltip Not Showing

**Check:**
1. Is `config.showTooltip` set to `true`? (default)
2. Is data array populated with valid values?
3. Are circles rendering correctly?
4. Check browser console for errors

**Debug:**
```tsx
<AprobacionD3Chart
  data={monthlyData}
  config={{
    showTooltip: true // Explicitly enable
  }}
/>
```

### Tooltip Positioning Issues

**Symptoms:**
- Tooltip cut off at edges
- Tooltip not following cursor

**Solutions:**
1. Ensure parent container has `position: relative`
2. Check containerWidth is calculated correctly
3. Verify no CSS `overflow: hidden` on parent

### Mobile Touch Issues

**Symptoms:**
- Tooltip not appearing on tap
- Page scrolling when tapping

**Solutions:**
1. Touch events use `preventDefault` (already implemented)
2. Ensure no conflicting touch handlers on parent
3. Check mobile browser compatibility

### Dark Mode Not Working

**Symptoms:**
- Tooltip always shows light colors

**Solutions:**
1. Verify `next-themes` is configured correctly
2. Check Tailwind dark mode is set to `class` strategy
3. Ensure parent component supports theme switching

## Advanced Customization

### Future: Custom Tooltip Template

*Not currently available, but planned:*

```tsx
<AprobacionD3Chart
  data={monthlyData}
  config={{
    tooltipTemplate: (data, metric) => (
      <CustomTooltip data={data} metric={metric} />
    )
  }}
/>
```

### Future: Tooltip Callbacks

*Not currently available, but planned:*

```tsx
<AprobacionD3Chart
  data={monthlyData}
  config={{
    onTooltipShow: (data) => console.log('Shown:', data),
    onTooltipHide: () => console.log('Hidden')
  }}
/>
```

## Examples

### Example 1: Basic Chart with Tooltip

```tsx
import { AprobacionD3Chart } from '@/components/aprobacion/chart/AprobacionD3Chart';

const data = [
  {
    id: '1',
    mes: 'Enero',
    aprobacionBase: 70.30,
    aprobacionRetry: 12.50,
    aprobacionCompuesta: 82.80,
    aprobacionFinal: 85.20,
    trxEnviadasTotales: 15000,
    trxAprobadasTotales: 12780,
    trxAuthCon3DS: 8500,
    pctAutenticadoCon3DS: 56.67,
    aprobadoCon3DS: 48.23
  },
  // ... more months
];

export function MyDashboard() {
  return (
    <div className="p-6">
      <h1>Aprobación Mensual</h1>
      <AprobacionD3Chart data={data} />
    </div>
  );
}
```

**Result:**
- Full-featured chart with interactive tooltips
- Dark/light mode support
- Mobile-friendly
- Accessible

### Example 2: With Click Handler

```tsx
export function MyDashboard() {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  return (
    <div className="p-6">
      <AprobacionD3Chart
        data={data}
        onMonthClick={(monthData) => {
          setSelectedMonth(monthData.mes);
          // Show detailed view, open modal, etc.
        }}
      />

      {selectedMonth && (
        <div className="mt-4">
          <h2>Selected: {selectedMonth}</h2>
          {/* Detailed information */}
        </div>
      )}
    </div>
  );
}
```

**Result:**
- Hover shows quick info (tooltip)
- Click shows detailed info (modal/panel)
- Rich, multi-level interaction

### Example 3: Minimal Configuration

```tsx
export function SimpleChart() {
  return (
    <AprobacionD3Chart
      data={data}
      config={{
        height: 300,
        showGrid: false,
        showTooltip: true // Tooltip still works!
      }}
    />
  );
}
```

**Result:**
- Simplified chart without grid
- Tooltips still provide rich data
- Cleaner visual aesthetic

## Summary

The tooltip implementation provides:

✅ **Zero configuration required** - Works out of the box
✅ **Smart positioning** - Adapts to screen edges automatically
✅ **Rich data display** - Shows comprehensive month information
✅ **Mobile optimized** - Touch-friendly interactions
✅ **Accessible** - Full screen reader and keyboard support
✅ **Theme aware** - Automatic dark/light mode
✅ **Performant** - Optimized for smooth interactions

Simply use `<AprobacionD3Chart data={data} />` and tooltips work perfectly!
