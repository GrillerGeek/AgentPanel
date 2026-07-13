// Curated base16-style palettes. Each `base` array is base00..base0F:
//   00 bg · 01 alt-bg · 02 selection · 03 dim/comment · 04 muted-fg · 05 fg
//   06 strong-fg · 07 lightest · 08 red · 09 orange · 0A yellow · 0B green
//   0C cyan · 0D blue · 0E magenta · 0F brown
// One palette drives both the app chrome (CSS vars) and the xterm ITheme — see
// ./apply.ts. Sourced from the well-known palettes (tinted-theming / upstream).

export interface Scheme {
  slug: string;
  name: string;
  variant: "dark" | "light";
  base: readonly string[]; // length 16
}

export const SCHEMES: Scheme[] = [
  {
    slug: "tokyo-night",
    name: "Tokyo Night",
    variant: "dark",
    base: ["#1a1b26","#1f2335","#292e42","#565f89","#a9b1d6","#c0caf5","#cbd0e8","#d5d6db","#f7768e","#ff9e64","#e0af68","#9ece6a","#7dcfff","#7aa2f7","#bb9af7","#db4b4b"],
  },
  {
    slug: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    variant: "dark",
    base: ["#1e1e2e","#181825","#313244","#45475a","#585b70","#cdd6f4","#f5e0dc","#b4befe","#f38ba8","#fab387","#f9e2af","#a6e3a1","#94e2d5","#89b4fa","#cba6f7","#f2cdcd"],
  },
  {
    slug: "dracula",
    name: "Dracula",
    variant: "dark",
    base: ["#282a36","#34354a","#44475a","#6272a4","#b6b6b2","#f8f8f2","#f8f8f2","#ffffff","#ff5555","#ffb86c","#f1fa8c","#50fa7b","#8be9fd","#bd93f9","#ff79c6","#ffb86c"],
  },
  {
    slug: "nord",
    name: "Nord",
    variant: "dark",
    base: ["#2e3440","#3b4252","#434c5e","#4c566a","#d8dee9","#e5e9f0","#eceff4","#8fbcbb","#bf616a","#d08770","#ebcb8b","#a3be8c","#88c0d0","#81a1c1","#b48ead","#5e81ac"],
  },
  {
    slug: "gruvbox-dark",
    name: "Gruvbox Dark",
    variant: "dark",
    base: ["#282828","#3c3836","#504945","#665c54","#bdae93","#d5c4a1","#ebdbb2","#fbf1c7","#fb4934","#fe8019","#fabd2f","#b8bb26","#8ec07c","#83a598","#d3869b","#d65d0e"],
  },
  {
    slug: "one-dark",
    name: "One Dark",
    variant: "dark",
    base: ["#282c34","#353b45","#3e4451","#545862","#565c64","#abb2bf","#b6bdca","#c8ccd4","#e06c75","#d19a66","#e5c07b","#98c379","#56b6c2","#61afef","#c678dd","#be5046"],
  },
  {
    slug: "everforest",
    name: "Everforest Dark",
    variant: "dark",
    base: ["#2d353b","#343f44","#3d484d","#859289","#9da9a0","#d3c6aa","#e4e1cd","#fdf6e3","#e67e80","#e69875","#dbbc7f","#a7c080","#83c092","#7fbbb3","#d699b6","#e69875"],
  },
  {
    slug: "rose-pine",
    name: "Rosé Pine",
    variant: "dark",
    base: ["#191724","#1f1d2e","#26233a","#6e6a86","#908caa","#e0def4","#e0def4","#f0eff6","#eb6f92","#f6c177","#ebbcba","#9ccfd8","#31748f","#c4a7e7","#c4a7e7","#ebbcba"],
  },
  {
    slug: "monokai",
    name: "Monokai",
    variant: "dark",
    base: ["#272822","#383830","#49483e","#75715e","#a59f85","#f8f8f2","#f5f4f1","#f9f8f5","#f92672","#fd971f","#f4bf75","#a6e22e","#a1efe4","#66d9ef","#ae81ff","#cc6633"],
  },
  {
    slug: "solarized-dark",
    name: "Solarized Dark",
    variant: "dark",
    base: ["#002b36","#073642","#586e75","#657b83","#839496","#93a1a1","#eee8d5","#fdf6e3","#dc322f","#cb4b16","#b58900","#859900","#2aa198","#268bd2","#6c71c4","#d33682"],
  },
  {
    slug: "solarized-light",
    name: "Solarized Light",
    variant: "light",
    base: ["#fdf6e3","#eee8d5","#cfcabb","#93a1a1","#657b83","#586e75","#073642","#002b36","#dc322f","#cb4b16","#b58900","#859900","#2aa198","#268bd2","#6c71c4","#d33682"],
  },
  {
    slug: "catppuccin-latte",
    name: "Catppuccin Latte",
    variant: "light",
    base: ["#eff1f5","#e6e9ef","#dce0e8","#acb0be","#6c6f85","#4c4f69","#404357","#3a3c4e","#d20f39","#fe640b","#df8e1d","#40a02b","#179299","#1e66f5","#8839ef","#dd7878"],
  },
  {
    slug: "material",
    name: "Material",
    variant: "dark",
    base: ["#263238","#2e3c43","#314549","#546e7a","#b2ccd6","#eeffff","#eeffff","#ffffff","#f07178","#f78c6c","#ffcb6b","#c3e88d","#89ddff","#82aaff","#c792ea","#ff5370"],
  },
  {
    slug: "github-dark",
    name: "GitHub Dark",
    variant: "dark",
    base: ["#0d1117","#161b22","#484f58","#6e7681","#8b949e","#c9d1d9","#f0f6fc","#ffffff","#ffa657","#79c0ff","#bb8009","#a5d6ff","#7ee787","#d2a8ff","#ff7b72","#ffa198"],
  },
  {
    slug: "ayu-dark",
    name: "Ayu Dark",
    variant: "dark",
    base: ["#0b0e14","#131721","#202229","#3e4b59","#bfbdb6","#e6e1cf","#ece8db","#f2f0e7","#f07178","#ff8f40","#ffb454","#aad94c","#95e6cb","#59c2ff","#d2a6ff","#e6b450"],
  },
  {
    slug: "ayu-mirage",
    name: "Ayu Mirage",
    variant: "dark",
    base: ["#1f2430","#242936","#323844","#4a5059","#707a8c","#cccac2","#d9d7ce","#f3f4f5","#f28779","#ffad66","#ffd173","#d5ff80","#95e6cb","#73d0ff","#d4bfff","#f27983"],
  },
  {
    slug: "material-palenight",
    name: "Material Palenight",
    variant: "dark",
    base: ["#292d3e","#444267","#32374d","#676e95","#8796b0","#959dcb","#959dcb","#ffffff","#f07178","#f78c6c","#ffcb6b","#c3e88d","#89ddff","#82aaff","#c792ea","#ff5370"],
  },
  {
    slug: "kanagawa",
    name: "Kanagawa",
    variant: "dark",
    base: ["#1f1f28","#16161d","#223249","#54546d","#727169","#dcd7ba","#c8c093","#717c7c","#c34043","#ffa066","#c0a36e","#76946a","#6a9589","#7e9cd8","#957fb8","#d27e99"],
  },
  {
    slug: "github-light",
    name: "GitHub Light",
    variant: "light",
    base: ["#ffffff","#f6f8fa","#afb8c1","#8c959f","#6e7781","#424a53","#32383f","#1f2328","#953800","#0550ae","#bf8700","#0a3069","#116329","#8250df","#cf222e","#82071e"],
  },
  {
    slug: "one-light",
    name: "One Light",
    variant: "light",
    base: ["#fafafa","#f0f0f1","#e5e5e6","#a0a1a7","#696c77","#383a42","#202227","#090a0b","#ca1243","#d75f00","#c18401","#50a14f","#0184bc","#4078f2","#a626a4","#986801"],
  },
  {
    slug: "gruvbox-light",
    name: "Gruvbox Light",
    variant: "light",
    base: ["#fbf1c7","#ebdbb2","#d5c4a1","#bdae93","#665c54","#504945","#3c3836","#282828","#9d0006","#af3a03","#b57614","#79740e","#427b58","#076678","#8f3f71","#d65d0e"],
  },
];
