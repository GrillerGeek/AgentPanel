export const logicalWrapQuery = "cross-wrap 👩🏽‍💻 中文 needle";
export const styledHistoryFixture = "\x1b[3J\x1b[2J\x1b[H\x1b]10;rgb:dd/dd/dd\x1b\\\x1b]11;rgb:22/33/44\x1b\\\x1b]4;16;rgb:00/00/00\x1b\\" +
  "History ABI1 · Unicode\r\n\x1b[48;2;0;0;0mRGBblack\x1b[49m \x1b[48;5;16mPALblack\x1b[0m\r\n" +
  "\x1b[1;3;4:3;53;38;5;3mStyled café é\x1b[0m\r\n" +
  "prefix:" + "a".repeat(13) + "\x1b]8;id=wrap;https://example.test/history\x1b\\" + logicalWrapQuery + "\x1b]8;;\x1b\\ :suffix\r\n" +
  "blank-tail \x1b[44m\x1b[3X\x1b[0m\r\n" + Array.from({ length: 10 }, (_, i) => `later-${i} 中 👩🏽‍💻\r\n`).join("");
