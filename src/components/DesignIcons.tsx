import { forwardRef, type SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
};

// These paths are static, reviewed assets from the supplied handoff.
const icon = (paths: string) =>
  forwardRef<SVGSVGElement, Props>(function DesignIcon(
    { size = 24, absoluteStrokeWidth, ...props }, ref,
  ) {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={absoluteStrokeWidth ? 1.8 * 24 / Number(size) : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={{ __html: paths }}
      />
    );
  });

export const ArrowLeft = icon("<path d=\"M19 12H5M11 18l-6-6 6-6\"/>");
export const ArrowRight = icon("<path d=\"M5 12h14M13 6l6 6-6 6\"/>");
export const ArrowDownUp = icon("<path d=\"M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4\"/>");
export const Code2 = icon("<path d=\"M8 6l-6 6 6 6M16 6l6 6-6 6\"/>");
export const Database = icon("<path d=\"M4 5.5a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3\"/>");
export const Grid2X2 = icon("<path d=\"M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z\"/>");
export const TerminalSquare = icon("<path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3 3-3 3M12 15h5\"/>");
export const Server = icon("<path d=\"M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM7 7.5h.01M7 16.5h.01\"/>");
export const Settings2 = icon("<path d=\"M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0\"/>");
export const Keyboard = icon("<path d=\"M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10\"/>");
export const Search = icon("<path d=\"M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4\"/>");
export const Plus = icon("<path d=\"M12 5v14M5 12h14\"/>");
export const X = icon("<path d=\"M6 6l12 12M18 6L6 18\"/>");
export const Save = icon("<path d=\"M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 4v5h7V4M8 20v-6h8v6\"/>");
export const Trash2 = icon("<path d=\"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3\"/>");
export const Pencil = icon("<path d=\"M4 20h4L19 9l-4-4L4 16z\"/>");
export const Copy = icon("<path d=\"M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2\"/>");
export const Folder = icon("<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>");
export const FolderOpen = icon("<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>");
export const FolderPlus = icon("<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6\"/>");
export const FilePlus = icon("<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6\"/>");
export const File = icon("<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5\"/>");
export const FileText = icon("<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5\"/>");
export const ChevronDown = icon("<path d=\"M6 9l6 6 6-6\"/>");
export const ChevronRight = icon("<path d=\"M9 6l6 6-6 6\"/>");
export const ChevronLeft = icon("<path d=\"M15 6l-6 6 6 6\"/>");
export const Send = icon("<path d=\"M21 3L10 14M21 3l-7 18-4-7-7-4z\"/>");
export const Check = icon("<path d=\"M5 12l5 5 9-10\"/>");
export const Calendar = icon("<path d=\"M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4\"/>");
export const CalendarDays = icon("<path d=\"M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4\"/>");
export const GitBranch = icon("<path d=\"M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 8.5v7M18 10.5c0 4-6 3-11 5.5\"/>");
export const RotateCcw = icon("<path d=\"M4 13a8 8 0 1 0 2.3-5.7M4 4v5h5\"/>");
export const RefreshCw = icon("<path d=\"M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7\"/>");
export const Scissors = icon("<path d=\"M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12\"/>");
export const ClipboardPaste = icon("<path d=\"M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2\"/>");
export const Lock = icon("<path d=\"M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3\"/>");
export const Sparkles = icon("<path d=\"M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z\"/>");
export const Wand2 = icon("<path d=\"M4 20L15 9M14 4v2M18 8h2M17 5l1-1M19 11l1 1M12 6l1-1\"/>");
export const PanelTopClose = icon("<path d=\"M7 4l5 5 5-5M7 20l5-5 5 5\"/>");
export const ExternalLink = icon("<path d=\"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3\"/>");
export const Link = icon("<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>");
export const Clock = icon("<path d=\"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2\"/>");
export const Shield = icon("<path d=\"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z\"/>");
export const AlertTriangle = icon("<path d=\"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01\"/>");
export const Play = icon("<path d=\"M7 5v14l12-7z\"/>");
export const Table2 = icon("<path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 10v10\"/>");
export const WandSparkles = icon("<path d=\"M4 20L15 9M14 4v2M18 8h2M17 5l1-1M19 11l1 1M12 6l1-1\"/>");
export const Sparkle = icon("<path d=\"M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z\"/>");
export const FoldVertical = icon("<path d=\"M7 4l5 5 5-5M7 20l5-5 5 5\"/>");
export const LocateFixed = icon("<path d=\"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3\"/>");
