import { Image as ImageIcon, Video } from "lucide-react";
import { cn } from "../../lib/utils";

type GeneratedMediaPlaceholderProps = {
  kind?: "image" | "video";
  label?: string;
  description?: string;
  compact?: boolean;
  className?: string;
};

export function isGeneratedMediaUrl(url?: string | null) {
  return typeof url === "string" && url.trim().length > 0 && !url.includes("mock.assets.local");
}

export function getGeneratedMediaUrl(url?: string | null) {
  return isGeneratedMediaUrl(url) ? url : null;
}

export function GeneratedMediaPlaceholder({
  kind = "image",
  label = "未生成",
  description,
  compact = false,
  className,
}: GeneratedMediaPlaceholderProps) {
  const Icon = kind === "video" ? Video : ImageIcon;

  return (
    <div
      className={cn(
        "flex items-center justify-center bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      <div className="flex max-w-[16rem] flex-col items-center gap-2 px-4 text-center">
        <Icon className={compact ? "h-5 w-5" : "h-9 w-9"} />
        <div className={compact ? "text-xs font-medium" : "text-sm font-medium"}>{label}</div>
        {description ? (
          <div className="text-[11px] leading-5 text-muted-foreground/80">{description}</div>
        ) : null}
      </div>
    </div>
  );
}
