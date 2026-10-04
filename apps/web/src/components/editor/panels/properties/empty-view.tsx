import { HugeiconsIcon } from "@hugeicons/react";
import { Settings05Icon } from "@hugeicons/core-free-icons";

export function EmptyView() {
	return (
		<div className="bg-background/50 flex h-full flex-col items-center justify-center gap-4 p-6 text-center select-none">
			<div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
				<HugeiconsIcon
					icon={Settings05Icon}
					className="size-7"
					strokeWidth={1.5}
				/>
			</div>
			<div className="flex flex-col gap-1.5 max-w-[220px]">
				<p className="text-sm font-semibold text-foreground tracking-tight">No Item Selected</p>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Select an element on the timeline or canvas to customize its properties
				</p>
			</div>
		</div>
	);
}
