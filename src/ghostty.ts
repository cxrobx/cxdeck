/**
 * Bring the Ghostty tab running the Herdr TUI to the front. The Herdr client
 * titles its tab "Herdr · …" (sometimes with a 🔔 prefix), so we match by
 * substring through Ghostty's AppleScript dictionary (1.3+), and fall back to
 * just activating Ghostty when no tab matches.
 */
import { execFile } from "node:child_process";

const SCRIPT = `
on run argv
	set needle to item 1 of argv
	tell application "Ghostty"
		repeat with w in windows
			repeat with t in tabs of w
				if name of t contains needle then
					focus (focused terminal of t)
					activate
					return "tab"
				end if
			end repeat
		end repeat
		activate
		return "app"
	end tell
end run`;

/** Resolves "tab" (matched), "app" (fallback activate) or "open" (AppleScript failed, used `open -a`). */
export function raiseHerdrWindow(needle: string): Promise<"tab" | "app" | "open"> {
	return new Promise((resolve) => {
		execFile("/usr/bin/osascript", ["-e", SCRIPT, needle || "Herdr"], { timeout: 4000 }, (err, stdout) => {
			if (!err) return resolve(stdout.trim() === "tab" ? "tab" : "app");
			execFile("/usr/bin/open", ["-a", "Ghostty"], () => resolve("open"));
		});
	});
}
