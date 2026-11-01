// Biome definitions: terrain character, palettes, vegetation and atmosphere tint.
// Colours are sRGB hex (converted to linear where used).
import type { BiomeId } from '../core/environment';

export type TreeStyle = 'temperate' | 'jungle' | 'savanna';

export interface BiomePalette {
  /** Lush ground cover */
  ground: number;
  /** Dry / sparse ground cover (blended by a moisture field) */
  groundDry: number;
  forest: number;
  forestDark: number;
  rock: number;
  snow: number;
  beach: number;
  /** Farmland patch colours (used when fields > 0) */
  fields: [number, number, number, number];
  urban: number;
  scorched: number;
}

export interface BiomeDef {
  id: BiomeId;
  /** Display name (Korean) */
  name: string;
  /** Short setting description (Korean) */
  description: string;
  palette: BiomePalette;
  /** Snow line (m ASL); Infinity = none */
  snowLine: number;
  /** Highest altitude with forest (m) */
  treeLine: number;
  /** Fraction of land covered by forest mask (0..1) */
  forestCover: number;
  /** Farmland patch coverage (0..1) */
  fieldCover: number;
  trees: TreeStyle | null;
  /** Instanced tree density multiplier near the camera */
  treeDensity: number;
  /** Slope (1 - normal.y) range where rock takes over */
  rockSlope: [number, number];
  /** Max amplitude (m) of the analytic fine-detail term */
  detailMeters: number;
  water: { deep: number; shallow: number };
  /** Horizon haze tint mixed into the sky/fog colour (0..1 strength in haze.amount) */
  haze: { color: number; amount: number };
  /** Ground bounce colour for the hemisphere light */
  bounce: number;
  /** Typical cumulus base altitude (m) */
  cloudBase: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  temperate: {
    id: 'temperate',
    name: '온대 평원',
    description: '독일 평원과 숲. 완만한 구릉, 농경지, 숲.',
    palette: {
      ground: 0x6f9c3f,
      groundDry: 0x93a64f,
      forest: 0x3a6a2a,
      forestDark: 0x28501f,
      rock: 0x8d877d,
      snow: 0xf3f6f9,
      beach: 0xd9cb9c,
      fields: [0xa7b54c, 0xcdb760, 0x76993c, 0x9b7f55],
      urban: 0x9a9893,
      scorched: 0x3b352e,
    },
    snowLine: 2600,
    treeLine: 1500,
    forestCover: 0.42,
    fieldCover: 0.75,
    trees: 'temperate',
    treeDensity: 1,
    rockSlope: [0.32, 0.5],
    detailMeters: 14,
    water: { deep: 0x1f4f72, shallow: 0x3f8f92 },
    haze: { color: 0xc8d8e6, amount: 0.15 },
    bounce: 0x6f7f4a,
    cloudBase: 1700,
  },
  mountains: {
    id: 'mountains',
    name: '산악 지대',
    description: '한반도와 알프스의 험준한 산맥. 깊은 계곡과 만년설.',
    palette: {
      ground: 0x6f9447,
      groundDry: 0x92a05e,
      forest: 0x335f2c,
      forestDark: 0x23461f,
      rock: 0x857e77,
      snow: 0xeef3f8,
      beach: 0xc8bf9e,
      fields: [0x93a94e, 0xb9ad62, 0x6d9040, 0x8f7b56],
      urban: 0x9a9893,
      scorched: 0x3b352e,
    },
    snowLine: 2150,
    treeLine: 1800,
    forestCover: 0.55,
    fieldCover: 0.25,
    trees: 'temperate',
    treeDensity: 0.8,
    rockSlope: [0.28, 0.46],
    detailMeters: 34,
    water: { deep: 0x1e4a68, shallow: 0x3c8a8e },
    haze: { color: 0xc4d6ea, amount: 0.12 },
    bounce: 0x5f6a4a,
    cloudBase: 2300,
  },
  desert: {
    id: 'desert',
    name: '사막',
    description: '사하라와 중동의 모래 바다. 사구, 메사, 바위 산지.',
    palette: {
      ground: 0xe2bb7c,
      groundDry: 0xd09a5c,
      forest: 0x8a8a4a,
      forestDark: 0x6f6f3a,
      rock: 0xa9785a,
      snow: 0xf3efe6,
      beach: 0xead39c,
      fields: [0x9aa04c, 0x8b9446, 0xb9a463, 0xa38a5a],
      urban: 0xc2b394,
      scorched: 0x4a3a2e,
    },
    snowLine: Infinity,
    treeLine: 0,
    forestCover: 0,
    fieldCover: 0.04,
    trees: null,
    treeDensity: 0,
    rockSlope: [0.3, 0.5],
    detailMeters: 26,
    water: { deep: 0x125a7c, shallow: 0x37b3b3 },
    haze: { color: 0xe3d3b3, amount: 0.45 },
    bounce: 0xb48a5a,
    cloudBase: 3200,
  },
  savanna: {
    id: 'savanna',
    name: '사바나',
    description: '동아프리카 초원. 건조한 풀밭, 아카시아, 화강암 구릉.',
    palette: {
      ground: 0x86973f,
      groundDry: 0xb29a52,
      forest: 0x6a7c34,
      forestDark: 0x4c5c26,
      rock: 0x93725a,
      snow: 0xf3f3ef,
      beach: 0xd9c38f,
      fields: [0x9aa546, 0xc0a85a, 0x88913f, 0xa7774c],
      urban: 0xb3a387,
      scorched: 0x3e3329,
    },
    snowLine: Infinity,
    treeLine: 2400,
    forestCover: 0.36,
    fieldCover: 0.1,
    trees: 'savanna',
    treeDensity: 0.55,
    rockSlope: [0.3, 0.52],
    detailMeters: 12,
    water: { deep: 0x1d5470, shallow: 0x3d9a92 },
    haze: { color: 0xd6cfb6, amount: 0.22 },
    bounce: 0x8a8048,
    cloudBase: 2400,
  },
  jungle: {
    id: 'jungle',
    name: '열대 우림',
    description: '서아프리카·중부 아프리카 밀림. 끝없는 수관과 강 계곡.',
    palette: {
      ground: 0x4f8f35,
      groundDry: 0x6f9a3c,
      forest: 0x3a7a2c,
      forestDark: 0x1b4818,
      rock: 0x756d5d,
      snow: 0xf3f6f9,
      beach: 0xcdb98a,
      fields: [0x7fa043, 0x96a74c, 0x5f8f37, 0x8a6b45],
      urban: 0xa09a8c,
      scorched: 0x35302a,
    },
    snowLine: Infinity,
    treeLine: 2600,
    forestCover: 0.82,
    fieldCover: 0.12,
    trees: 'jungle',
    treeDensity: 1.25,
    rockSlope: [0.38, 0.6],
    detailMeters: 16,
    water: { deep: 0x284f4a, shallow: 0x4d7f62 },
    haze: { color: 0xc6d8d2, amount: 0.3 },
    bounce: 0x4c6a34,
    cloudBase: 1300,
  },
  arctic: {
    id: 'arctic',
    name: '북극권',
    description: '스칸디나비아·북극의 피오르드. 눈 덮인 산과 차가운 바다.',
    palette: {
      ground: 0x7d8a6e,
      groundDry: 0x948f78,
      forest: 0x35533a,
      forestDark: 0x253e2b,
      rock: 0x5f646b,
      snow: 0xe6edf5,
      beach: 0x9c9a90,
      fields: [0x8d977f, 0x9fa08a, 0x7f8c74, 0x8a8170],
      urban: 0x9a9ca0,
      scorched: 0x3b3a38,
    },
    snowLine: 380,
    treeLine: 500,
    forestCover: 0.25,
    fieldCover: 0,
    trees: null,
    treeDensity: 0,
    rockSlope: [0.22, 0.4],
    detailMeters: 24,
    water: { deep: 0x142f45, shallow: 0x2f5c6e },
    haze: { color: 0xdde8f2, amount: 0.25 },
    bounce: 0xb8c4cf,
    cloudBase: 1100,
  },
  ocean: {
    id: 'ocean',
    name: '대양',
    description: '넓은 대양과 화산섬. 산호초의 얕은 바다.',
    palette: {
      ground: 0x5f9c3c,
      groundDry: 0x8ea24c,
      forest: 0x2f6c2a,
      forestDark: 0x225421,
      rock: 0x7a7168,
      snow: 0xf3f6f9,
      beach: 0xeadfb0,
      fields: [0x7fa043, 0x9aa94e, 0x6a9a3c, 0x8a7350],
      urban: 0xa3a09a,
      scorched: 0x35302a,
    },
    snowLine: Infinity,
    treeLine: 900,
    forestCover: 0.6,
    fieldCover: 0.1,
    trees: 'jungle',
    treeDensity: 0.8,
    rockSlope: [0.34, 0.55],
    detailMeters: 10,
    water: { deep: 0x0d4c88, shallow: 0x22b8c4 },
    haze: { color: 0xcfe2f0, amount: 0.2 },
    bounce: 0x2a5a7a,
    cloudBase: 1100,
  },
  wasteland: {
    id: 'wasteland',
    name: '핵 폐허',
    description: '전술핵으로 폐허가 된 동남아. 잿빛 대지와 크레이터.',
    palette: {
      ground: 0x66645a,
      groundDry: 0x76695a,
      forest: 0x55513c,
      forestDark: 0x3f3c2d,
      rock: 0x6a635c,
      snow: 0xe9e8e4,
      beach: 0x9c9480,
      fields: [0x77735e, 0x6e6a54, 0x837a62, 0x625c4b],
      urban: 0x6e6b66,
      scorched: 0x2a2523,
    },
    snowLine: Infinity,
    treeLine: 1200,
    forestCover: 0.3,
    fieldCover: 0,
    trees: null,
    treeDensity: 0,
    rockSlope: [0.28, 0.48],
    detailMeters: 14,
    water: { deep: 0x263a40, shallow: 0x4b6358 },
    haze: { color: 0x9c9284, amount: 0.3 },
    bounce: 0x5a5244,
    cloudBase: 1500,
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];
