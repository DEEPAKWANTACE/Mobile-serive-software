export type ThemeMode = 'dark' | 'light';

export type ThemeDefinition = {
  id: string;
  name: string;
  mode: ThemeMode;
  description: string;
  /** Background, section, surface, raised surface, text, accent, accent text. */
  colors: readonly [string, string, string, string, string, string, string];
  signature?: boolean;
};

/** Keep palette values together so the picker, persistence and CSS variables
 * share one source of truth. */
export const THEMES: readonly ThemeDefinition[] = [
  { id: 'dark', name: 'Dark', mode: 'dark', description: 'Dark theme for comfortable viewing in low light', colors: ['#020817', '#030e26', '#04112f', '#1d2839', '#f8fafc', '#3c83f6', '#020817'] },
  { id: 'onyx', name: 'Onyx', mode: 'dark', description: 'Deep obsidian black with sleek metallic platinum accents', colors: ['#0a0a0a', '#121212', '#171717', '#1f1f1f', '#f5f5f5', '#adb6c2', '#0a0a0a'] },
  { id: 'light', name: 'Light', mode: 'light', description: 'Clean light theme for bright environments', colors: ['#ffffff', '#fafafa', '#f5f5f5', '#edf2f7', '#020817', '#3c83f6', '#ffffff'] },
  { id: 'ocean', name: 'Ocean', mode: 'dark', description: 'Cool blue theme inspired by deep ocean waters', colors: ['#0a181f', '#0f242e', '#14303d', '#0f363d', '#ccffff', '#00ffff', '#0a181f'] },
  { id: 'sunset', name: 'Sunset', mode: 'dark', description: 'Warm orange-red theme inspired by evening skies', colors: ['#1d100c', '#2b1812', '#392118', '#392313', '#ffe6cc', '#ff7033', '#ffe6cc'] },
  { id: 'forest', name: 'Forest', mode: 'dark', description: 'Natural green theme inspired by deep forests', colors: ['#0e1b0e', '#152815', '#1d351d', '#173617', '#e0ebe0', '#33cc33', '#0e1b0e'] },
  { id: 'lime', name: 'Lime', mode: 'dark', description: 'Vibrant lime green theme for energy and focus', colors: ['#171d0c', '#232b12', '#2e3918', '#2d3913', '#e7ebe0', '#bbff33', '#171d0c'] },
  { id: 'purple', name: 'Purple', mode: 'dark', description: 'Rich purple theme for creativity and elegance', colors: ['#140c1d', '#1f122b', '#291839', '#261339', '#e6e0eb', '#9947eb', '#140c1d'] },
  { id: 'rose', name: 'Rose', mode: 'dark', description: 'Soft rose theme with warm pink undertones', colors: ['#1b0e10', '#281518', '#351d21', '#36171c', '#ebe0e2', '#eb4763', '#1b0e10'] },
  { id: 'amber', name: 'Amber', mode: 'dark', description: 'Golden amber theme for warmth and comfort', colors: ['#1d180c', '#2b2512', '#393118', '#393013', '#ebe8e0', '#ffcc33', '#1d180c'] },
  { id: 'slate', name: 'Slate', mode: 'dark', description: 'Cool slate theme for professional environments', colors: ['#0f1419', '#171d26', '#1f2733', '#192434', '#e2e5e9', '#5c8fd6', '#0f1419'] },
  { id: 'lavender-light', name: 'Lavender Light', mode: 'light', description: 'Soft lavender theme with gentle purple tones', colors: ['#f7f5ff', '#ebe8fc', '#edebfa', '#e5e2f3', '#22212c', '#664de6', '#f7f5ff'] },
  { id: 'mint-light', name: 'Mint Light', mode: 'light', description: 'Fresh mint green theme for a clean feel', colors: ['#f5fffa', '#e8fcf2', '#ebfaf2', '#e2f3eb', '#1f2e26', '#22c373', '#f5fffa'] },
  { id: 'peach-light', name: 'Peach Light', mode: 'light', description: 'Warm peach theme with soft orange undertones', colors: ['#fff8f5', '#fcefe8', '#faf0eb', '#f3e8e2', '#2e241f', '#f28c5a', '#fff8f5'] },
  { id: 'sky-light', name: 'Sky Light', mode: 'light', description: 'Bright sky blue theme like a clear day', colors: ['#f5fcff', '#e8f6fc', '#ebf5fa', '#e2edf3', '#1f292e', '#25aff4', '#f5fcff'] },
  { id: 'coral-light', name: 'Coral Light', mode: 'light', description: 'Vibrant coral theme with warm pink accents', colors: ['#fff5f7', '#fce8eb', '#faebed', '#f3e2e5', '#2e1f21', '#ed5e76', '#fff5f7'] },
  { id: 'lemon-light', name: 'Lemon Light', mode: 'light', description: 'Bright lemon yellow theme for energy and focus', colors: ['#fffff5', '#fcfce8', '#fafaeb', '#f3f3e2', '#2e2e1f', '#f2f20d', '#2e2e1f'] },
  { id: 'steel-blue', name: 'Steel Blue', mode: 'dark', description: 'Sophisticated steel blue with grayish undertones', colors: ['#0f1419', '#171f26', '#171f26', '#1b2632', '#e2e6e9', '#70a6db', '#0f1419'], signature: true },
  { id: 'steel-blue-light', name: 'Steel Blue Light', mode: 'light', description: 'Light steel blue perfect for professional environments', colors: ['#f8fafc', '#eef2f6', '#f1f5f8', '#e6ebf0', '#1d2630', '#70a6db', '#f8fafc'] },
  { id: 'dusty-blue', name: 'Dusty Blue', mode: 'dark', description: 'Muted dusty blue with vintage charm', colors: ['#101418', '#181e25', '#181e25', '#1d2530', '#e2e5e9', '#6190d1', '#101418'] },
  { id: 'dusty-blue-light', name: 'Dusty Blue Light', mode: 'light', description: 'Soft dusty blue for elegant light themes', colors: ['#f8fafc', '#eff2f5', '#f2f4f8', '#e7eaef', '#1f252e', '#6190d1', '#f8fafc'] },
  { id: 'powder-blue', name: 'Powder Blue', mode: 'dark', description: 'Gentle powder blue with calming vibes', colors: ['#0e161b', '#152228', '#152228', '#192b34', '#e1e7ea', '#67bbe4', '#0e161b'] },
  { id: 'powder-blue-light', name: 'Powder Blue Light', mode: 'light', description: 'Soft powder blue for serene light environments', colors: ['#f8fbfc', '#eef4f7', '#f1f6f9', '#e4edf1', '#1d2930', '#67bbe4', '#f8fbfc'] },
  { id: 'midnight-purple', name: 'Midnight Purple', mode: 'dark', description: 'Deep purple with midnight blue undertones', colors: ['#0b0811', '#140f1f', '#171122', '#1b122b', '#f2f1f4', '#8c5af2', '#0b0811'] },
  { id: 'emerald-dark', name: 'Emerald Dark', mode: 'dark', description: 'Rich emerald green with sophisticated elegance', colors: ['#08160d', '#0e2516', '#112c1a', '#0f331b', '#e8eeea', '#3cdd71', '#08160d'] },
  { id: 'emerald-light', name: 'Emerald Light', mode: 'light', description: 'Fresh emerald green for vibrant light themes', colors: ['#f3fcf6', '#e8f7ed', '#e9f7ed', '#e0f0e5', '#15281c', '#26d962', '#f3fcf6'] },
  { id: 'crimson-dark', name: 'Crimson Dark', mode: 'dark', description: 'Bold crimson red for striking designs', colors: ['#1b090c', '#2a0e13', '#361218', '#390e15', '#eee8e9', '#f91f44', '#1b090c'] },
  { id: 'teal-dark', name: 'Teal Dark', mode: 'dark', description: 'Sophisticated teal with balanced vibes', colors: ['#0b1918', '#112725', '#153230', '#123633', '#e8eeed', '#20dfcf', '#0b1918'] },
  { id: 'teal-light', name: 'Teal Light', mode: 'light', description: 'Light teal for calm and serene interfaces', colors: ['#f3fcfb', '#e9f7f5', '#e9f7f5', '#e0f0ef', '#172625', '#22c3b6', '#f3fcfb'] },
  { id: 'gold-dark', name: 'Gold Dark', mode: 'dark', description: 'Luxurious gold with dark sophisticated background', colors: ['#1b160e', '#282215', '#2e2719', '#362b17', '#ebe7e0', '#f5b83d', '#1b160e'] },
  { id: 'burgundy-dark', name: 'Burgundy Dark', mode: 'dark', description: 'Deep burgundy for elegant and refined look', colors: ['#180c10', '#261219', '#2d161d', '#34141e', '#e9e2e4', '#cc3366', '#180c10'] },
  { id: 'indigo-dark', name: 'Indigo Dark', mode: 'dark', description: 'Deep indigo blue for creative professionals', colors: ['#080b16', '#0e1225', '#11152c', '#0f1533', '#eaebf0', '#5a73f2', '#080b16'] },
  { id: 'indigo-light', name: 'Indigo Light', mode: 'light', description: 'Soft indigo light theme for creativity', colors: ['#f7f8fd', '#eceef9', '#eceef9', '#e3e6f2', '#1b1f32', '#4d66e6', '#f7f8fd'] },
  { id: 'saffron-dark', name: 'Saffron Dark', mode: 'dark', description: 'Warm saffron orange with dark elegance', colors: ['#19120b', '#271c11', '#2e2114', '#362412', '#e9e6e2', '#ff8c1a', '#19120b'] },
  { id: 'sage-dark', name: 'Sage Dark', mode: 'dark', description: 'Muted sage green for calming interfaces', colors: ['#11190f', '#1a2617', '#1e2d1b', '#1f321b', '#dee3dd', '#5eb34d', '#11190f'] },
  { id: 'sage-light', name: 'Sage Light', mode: 'light', description: 'Soft sage green for peaceful light themes', colors: ['#f5faf4', '#ecf5ea', '#ecf5ea', '#e4eee2', '#212e1f', '#50a63f', '#f5faf4'] },
];

export const DEFAULT_THEME_ID = 'steel-blue';

export function findTheme(id: string | null | undefined): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!;
}
