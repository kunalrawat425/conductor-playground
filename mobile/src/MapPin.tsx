/**
 * "Or move the pin" (organisms/LocationPickerSheet.astro) without a map SDK: OpenStreetMap tiles at zoom 16 in a
 * 3×3 grid, drag to move, a fixed pin in the middle; the point under the pin is reported when the drag ends.
 * OSM tile policy: light use, a User-Agent and the attribution line. ponytail: no zoom or tile prefetch; add if needed.
 */
import { useRef, useState } from "react";
import { Image, PanResponder, View } from "react-native";
import { useTheme } from "./theme";
import { Text } from "./ui/base";
import { Icon } from "./ui/icons";

const Z = 16, T = 256;
const toPx = (lat: number, lng: number) => {
  const n = 2 ** Z * T, r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
const toLatLng = (x: number, y: number) => {
  const n = 2 ** Z * T;
  return { lng: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
};

export function MapPin({ lat, lng, onMove, height = 220 }: { lat: number; lng: number; onMove: (lat: number, lng: number) => void; height?: number }) {
  const t = useTheme();
  const [center, setCenter] = useState(() => toPx(lat, lng));
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [w, setW] = useState(358);
  const c = useRef(center); c.current = center;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => setDrag({ x: g.dx, y: g.dy }),
    onPanResponderRelease: (_, g) => {
      const next = { x: c.current.x - g.dx, y: c.current.y - g.dy };
      setCenter(next); setDrag({ x: 0, y: 0 });
      const p = toLatLng(next.x, next.y); onMove(p.lat, p.lng);
    },
  })).current;
  const tx = Math.floor(center.x / T), ty = Math.floor(center.y / T);
  const tiles = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = tx + dx, y = ty + dy;
    tiles.push(<Image key={`${x}-${y}`} source={{ uri: `https://tile.openstreetmap.org/${Z}/${x}/${y}.png`, headers: { "User-Agent": "Relifish-app (support@relifish.com)" } }}
      style={{ position: "absolute", width: T, height: T, left: x * T - center.x + w / 2 + drag.x, top: y * T - center.y + height / 2 + drag.y }} />);
  }
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers} style={{ height, borderRadius: 12, overflow: "hidden", backgroundColor: t.bg3 }}>
      {tiles}
      <View pointerEvents="none" style={{ position: "absolute", left: w / 2 - 16, top: height / 2 - 32 }}><Icon name="pin" size={32} color={t.red} /></View>
      <Text style={{ position: "absolute", right: 4, bottom: 2, fontSize: 9, color: "#334155", backgroundColor: "rgba(255,255,255,.75)", paddingHorizontal: 3 }}>© OpenStreetMap contributors</Text>
    </View>
  );
}
