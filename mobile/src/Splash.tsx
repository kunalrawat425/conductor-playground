/**
 * The site's #rf-splash (components/ui/AppShell.astro) over the app's first screen, 2 s then a 350 ms fade.
 * Diwali: maroon radial, string of lights, gold logo, "Wishing you light, joy and good health", HAPPY DIWALI, a diya.
 * Normal: brand gradient, white logo, "Fresh fish. Cleaned. Cut. At your door.", the sellers line, a swimming fish.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFestive } from "./theme";
import { grad, Text } from "./ui/base";
import { DiwaliLights, Diya } from "./ui/chrome";
import { pal } from "./theme/palette";

const FISH = `<svg viewBox="0 0 64 32"><path d="M4 16c8-11 26-13 40-4l12-8v24l-12-8C30 29 12 27 4 16z" fill="${pal.white}" opacity=".9"/><circle cx="16" cy="14" r="2.4" fill="${pal.h0066FF}"/></svg>`;

export function Splash({ still }: { /** gallery: no fade */ still?: boolean } = {}) {
  const festive = useFestive();
  const top = useSafeAreaInsets().top;
  const [on, setOn] = useState(true);
  const fade = useRef(new Animated.Value(1)).current;
  const swim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(swim, { toValue: -5, duration: 700, useNativeDriver: true }), Animated.timing(swim, { toValue: 0, duration: 700, useNativeDriver: true })]));
    loop.start();
    if (still) return () => loop.stop();
    const id = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => setOn(false)), 2000);
    return () => { clearTimeout(id); loop.stop(); };
  }, [fade, swim, still]);
  if (!on) return null;
  const gold = pal.hFDE7B0;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 10000, opacity: fade, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: festive ? pal.h6E0822 : pal.h0066FF },
      grad(festive ? `radial-gradient(circle at 50% 45%, ${pal.hB3123B}, ${pal.h6E0822} 70%, ${pal.h4A0618})` : `linear-gradient(160deg, ${pal.h0066FF}, ${pal.h0047B3})`)]}>
      {festive ? <View style={{ position: "absolute", top, left: 0, right: 0, height: 22 }}><DiwaliLights height={22} /></View> : null}
      <Image source={festive ? require("../assets/logo-gold.png") : require("../assets/logo-white.png")} style={{ width: "70%", maxWidth: 300, aspectRatio: 600 / 143, height: undefined }} resizeMode="contain" />
      <Text style={{ marginTop: 2, fontSize: 16, fontWeight: "700", color: festive ? gold : pal.white }}>{festive ? "Wishing you light, joy and good health" : "Fresh fish. Cleaned. Cut. At your door."}</Text>
      <View style={{ width: 140, height: 1, backgroundColor: pal.a255_255_255_035, marginTop: 8, marginBottom: 2 }} />
      <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 2.42, textTransform: "uppercase", color: festive ? gold : pal.a255_255_255_085 }}>{festive ? "Happy Diwali" : "From verified Thane & Mumbai sellers"}</Text>
      <View style={{ position: "absolute", bottom: "14%", alignItems: "center" }}>
        {festive ? <Diya /> : <Animated.View style={{ transform: [{ translateY: swim }] }}><SvgXml xml={FISH} width={34} height={17} /></Animated.View>}
      </View>
    </Animated.View>
  );
}
