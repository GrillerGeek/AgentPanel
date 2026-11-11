/** Streaming byte parser. Only OSC 0/2 emits; other control strings are opaque. */
export class OscTitleParser {
  private state: "text" | "esc" | "osc" | "oscEsc" | "opaque" | "opaqueEsc" = "text";
  private payload: number[] = [];
  private overflow = false;
  constructor(private emit: (title: string) => void, private maxBytes = 4096) {}
  write(bytes: Uint8Array) {
    for (const byte of bytes) {
      switch (this.state) {
        case "text": if (byte === 27) this.state = "esc"; break;
        case "esc":
          if (byte === 93) { this.state = "osc"; this.payload = []; this.overflow = false; }
          else if (byte === 80 || byte === 88 || byte === 94 || byte === 95) this.state = "opaque";
          else this.state = byte === 27 ? "esc" : "text";
          break;
        case "osc":
          if (byte === 7) this.finish();
          else if (byte === 27) this.state = "oscEsc";
          else if (byte === 24 || byte === 26) this.reset();
          else this.append(byte);
          break;
        case "oscEsc":
          if (byte === 92) this.finish();
          else { // A malformed escape cancels this OSC; resynchronize at the new escape.
            this.reset(); this.state = "esc"; this.write(Uint8Array.of(byte));
          }
          break;
        case "opaque":
          if (byte === 27) this.state = "opaqueEsc";
          else if (byte === 24 || byte === 26) this.reset();
          break;
        case "opaqueEsc":
          if (byte === 92 || byte === 24 || byte === 26) this.reset();
          else this.state = byte === 27 ? "opaqueEsc" : "opaque";
      }
    }
  }
  private append(byte: number) {
    if (this.payload.length < this.maxBytes && !this.overflow) this.payload.push(byte);
    else { this.overflow = true; this.payload = []; }
  }
  private finish() {
    if (!this.overflow && (this.payload[0] === 48 || this.payload[0] === 50) && this.payload[1] === 59) {
      const title = new TextDecoder().decode(Uint8Array.from(this.payload.slice(2)));
      this.reset(); this.emit(title); return;
    }
    this.reset();
  }
  reset() { this.state = "text"; this.payload = []; this.overflow = false; }
}
