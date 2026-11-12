//! AgentPanel experimental bounded metadata ABI v1. The 16-byte render ABI is unchanged.
//! JSON is written directly into a caller-owned bounded buffer. Negative results are errors;
//! the caller MUST discard partial bytes. No screen switch, stream write or cursor mutation.
const std = @import("std");
const Terminal = @import("../Terminal.zig");
const Style = @import("../style.zig").Style;
const color = @import("../color.zig");
const Page = @import("../page.zig").Page;
const Cell = @import("../page.zig").Cell;
const Writer = std.Io.Writer;
const MetadataError = error{ StringLimit, Unavailable } || Writer.Error;

fn rgb(value: color.RGB) u32 {
    return (@as(u32, value.r) << 16) | (@as(u32, value.g) << 8) | @as(u32, value.b);
}
fn writeColor(writer: *Writer, value: Style.Color) Writer.Error!void {
    switch (value) {
        .none => try writer.writeAll("0,0"),
        .palette => |index| try writer.print("1,{d}", .{index}),
        .rgb => |value_rgb| try writer.print("2,{d}", .{rgb(value_rgb)}),
    }
}
fn writeString(writer: *Writer, text: []const u8, used: *usize, limit: usize) MetadataError!void {
    if (text.len > limit - used.*) return error.StringLimit;
    used.* += text.len;
    try std.json.Stringify.value(text, .{}, writer);
}
fn writeCell(writer: *Writer, page: *const Page, cell: *const Cell, used: *usize, limit: usize) MetadataError!void {
    var bytes: [4096]u8 = undefined;
    var length: usize = 0;
    if (cell.hasText() and cell.wide != .spacer_head and cell.wide != .spacer_tail) {
        length += std.unicode.utf8Encode(cell.codepoint(), bytes[length..][0..4]) catch return error.Unavailable;
        if (page.lookupGrapheme(cell)) |extra| {
            if (extra.len >= 1024) return error.StringLimit;
            for (extra) |cp| {
                if (length > bytes.len - 4) return error.StringLimit;
                length += std.unicode.utf8Encode(cp, bytes[length..][0..4]) catch return error.Unavailable;
            }
        }
    }
    const style: Style = if (cell.style_id > 0) page.styles.get(page.memory, cell.style_id).* else .{};
    const background: Style.Color = switch (cell.content_tag) {
        .bg_color_palette => .{ .palette = cell.content.color_palette },
        .bg_color_rgb => .{ .rgb = .{ .r = cell.content.color_rgb.r, .g = cell.content.color_rgb.g, .b = cell.content.color_rgb.b } },
        else => style.bg_color,
    };
    var flags: u16 = 0;
    if (style.flags.bold) flags |= 1;
    if (style.flags.faint) flags |= 2;
    if (style.flags.italic) flags |= 4;
    if (style.flags.blink) flags |= 8;
    if (style.flags.inverse) flags |= 16;
    if (style.flags.invisible) flags |= 32;
    if (style.flags.strikethrough) flags |= 64;
    if (style.flags.overline) flags |= 128;
    try writer.writeByte('[');
    try writeString(writer, bytes[0..length], used, limit);
    try writer.print(",{d},{d},", .{ @intFromEnum(cell.wide), @intFromBool(cell.hasText()) });
    try writeColor(writer, style.fg_color);
    try writer.writeByte(',');
    try writeColor(writer, background);
    try writer.writeByte(',');
    try writeColor(writer, style.underline_color);
    try writer.print(",{d},{d},", .{ flags, @intFromEnum(style.flags.underline) });
    if (page.lookupHyperlink(cell)) |id| {
        const link = page.hyperlink_set.get(page.memory, id);
        try writeString(writer, link.uri.slice(page.memory), used, limit);
        try writer.writeByte(',');
        switch (link.id) {
            .explicit => |explicit| try writeString(writer, explicit.slice(page.memory), used, limit),
            .implicit => try writer.writeAll("null"),
        }
    } else try writer.writeAll("null,null");
    try writer.writeByte(']');
}
fn writeMetadata(terminal: *const Terminal, which: u32, detail: u32, writer: *Writer, string_limit: usize) MetadataError!void {
    const screen = if (which == 1) terminal.screens.get(.primary) orelse return error.Unavailable else terminal.screens.active;
    const pages = &screen.pages;
    const alternate = terminal.screens.active_key == .alternate;
    const screen_alternate = which == 0 and alternate;
    const active = terminal.screens.active;
    const history = pages.total_rows - pages.rows;
    try writer.print("{{\"abi\":1,\"screen\":{d},\"active\":{d},\"cols\":{d},\"height\":{d},\"history\":{d},\"cursor\":[{d},{d},{d}],\"activeCursor\":[{d},{d},{d}],", .{
        @intFromBool(screen_alternate),           @intFromBool(alternate), pages.cols,                               pages.rows,      history,
        screen.cursor.x,                          screen.cursor.y,         @intFromBool(screen.cursor.pending_wrap), active.cursor.x, active.cursor.y,
        @intFromBool(active.cursor.pending_wrap),
    });
    if (detail == 1) {
        const foreground = terminal.colors.foreground.get() orelse color.RGB{ .r = 204, .g = 204, .b = 204 };
        const background = terminal.colors.background.get() orelse color.RGB{ .r = 0, .g = 0, .b = 0 };
        const cursor = terminal.colors.cursor.get() orelse foreground;
        try writer.print("\"colors\":{{\"foreground\":{d},\"background\":{d},\"cursor\":{d},\"palette\":[", .{ rgb(foreground), rgb(background), rgb(cursor) });
        for (terminal.colors.palette.current, 0..) |value, index| {
            if (index > 0) try writer.writeByte(',');
            try writer.print("{d}", .{rgb(value)});
        }
        try writer.writeAll("]},");
    }
    try writer.writeAll("\"rows\":[");
    var string_used: usize = 0;
    for (0..pages.total_rows) |y| {
        if (y > 0) try writer.writeByte(',');
        const pin = pages.pin(.{ .history = .{ .y = @intCast(y) } }) orelse return error.Unavailable;
        const row = pin.rowAndCell().row;
        const cells = pin.cells(.all);
        if (cells.len != pages.cols) return error.Unavailable;
        try writer.print("[{d},{d},", .{ @intFromBool(row.wrap), @intFromBool(row.wrap_continuation) });
        if (detail == 0) {
            if (cells.len * 2 > string_limit - string_used) return error.StringLimit;
            string_used += cells.len * 2;
            try writer.writeByte('"');
            for (cells) |cell| try writer.writeByte('0' + @as(u8, @intFromEnum(cell.wide)));
            try writer.writeAll("\",\"");
            for (cells) |cell| try writer.writeByte(if (cell.hasText()) '1' else '0');
            try writer.writeByte('"');
        } else {
            try writer.writeByte('[');
            for (cells, 0..) |*cell, x| {
                if (x > 0) try writer.writeByte(',');
                try writeCell(writer, &pin.node.data, cell, &string_used, string_limit);
            }
            try writer.writeByte(']');
        }
        try writer.writeByte(']');
    }
    try writer.writeAll("]}");
}
/// screen 0=active, 1=primary; detail 0=lightweight rows, 1=styled cells.
/// -1 invalid; -2 row/cell/hard limit; -3 output capacity; -4 strings; -5 unavailable.
pub fn capture(terminal: *const Terminal, which: u32, detail: u32, output: ?[*]u8, capacity: usize, max_rows: usize, max_cells: usize, max_strings: usize) c_int {
    if (which > 1 or detail > 1 or output == null) return -1;
    if (capacity == 0 or capacity > 64 * 1024 * 1024 or max_rows == 0 or max_rows > 8192 or max_cells == 0 or max_cells > 1024 * 1024 or max_strings == 0 or max_strings > 8 * 1024 * 1024) return -2;
    const screen = if (which == 1) terminal.screens.get(.primary) orelse return -5 else terminal.screens.active;
    if (screen.pages.total_rows > max_rows or @as(usize, screen.pages.cols) * screen.pages.total_rows > max_cells) return -2;
    var writer = Writer.fixed(output.?[0..capacity]);
    writeMetadata(terminal, which, detail, &writer, max_strings) catch |err| return switch (err) {
        error.StringLimit => -4,
        error.Unavailable => -5,
        error.WriteFailed => -3,
    };
    return @intCast(writer.buffered().len);
}
