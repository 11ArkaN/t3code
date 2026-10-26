import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useClientSettings } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { type CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { CommandCollection, CommandGroup, CommandItem, CommandList } from "../ui/command";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "./ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "./projectFilesQueryState";

interface ProjectFilePickerProps {
  readonly setOpen: (open: boolean) => void;
}

function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
}) {
  if (!props.active) return props.value;

  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) parts.push(props.value.slice(start, index));
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {props.value[index]}
      </strong>,
    );
    start = index + 1;
  }
  if (start < props.value.length) parts.push(props.value.slice(start));

  return <span className="text-muted-foreground">{parts}</span>;
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

function EmptyProjectFilePicker() {
  return (
    <CommandPaletteContent
      aria-label="File picker"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ disabled: true, placeholder: "Search files…" }}
      mode="none"
      testId="project-file-picker"
      value=""
    >
      <div className="py-10 text-center text-sm text-muted-foreground redesign:px-8 redesign:py-14 redesign:text-secondary-label redesign:text-balance">
        Open a project to search its files.
      </div>
    </CommandPaletteContent>
  );
}

function OpenProjectFilePicker(props: ProjectFilePickerProps & { target: ActiveProjectTarget }) {
  const { target } = props;
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const result = useProjectFilePickerQuery(
    target.environmentId,
    target.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
  );
  const { resolvedTheme } = useTheme();
  const redesign = useClientSettings((settings) => settings.redesignEnabled);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const matches = getProjectFilePickerMatches(result.entries, result.matchedQuery);
  const hasMatchedQuery = /\S/.test(result.matchedQuery);
  const items: CommandPaletteActionItem[] = matches.map((match) => ({
    kind: "action",
    value: `file:${match.path}`,
    searchTerms: [match.name, match.path],
    title: (
      <span className="redesign:font-medium redesign:text-foreground/75 redesign:in-data-highlighted:text-foreground">
        <HighlightedFuzzyText
          active={hasMatchedQuery}
          value={match.name}
          indices={match.nameMatchIndices}
        />
      </span>
    ),
    description: (
      <span className="redesign:text-secondary-label">
        <HighlightedFuzzyText
          active={hasMatchedQuery}
          value={match.path}
          indices={match.pathMatchIndices}
        />
      </span>
    ),
    icon: (
      <span className="redesign:text-muted-foreground redesign:opacity-70 redesign:grayscale redesign:in-data-highlighted:opacity-100 redesign:in-data-highlighted:grayscale-0">
        <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />
      </span>
    ),
    run: async () => {
      useRightPanelStore.getState().openFile(target.threadRef, match.path);
    },
  }));

  const emptyStateMessage = getEmptyStateMessage(query, result.error, result.isPending);

  return (
    <CommandPaletteContent
      aria-label="File picker"
      autoHighlight="always"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ placeholder: "Search files…" }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={(value) => {
        setHighlightedItemValue(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="project-file-picker"
      value={query}
    >
      {items.length > 0 ? (
        <div className="hidden h-7 shrink-0 items-center justify-between gap-3 px-4 text-xs redesign:flex">
          <span className="truncate font-medium text-foreground/75">{target.projectName}</span>
          <span className="shrink-0 text-secondary-label tabular-nums">
            {items.length}
            {items.length === PROJECT_FILE_PICKER_RESULT_LIMIT ? "+" : ""} results
          </span>
        </div>
      ) : null}
      {redesign && items.length > 0 ? (
        <CommandList>
          <CommandGroup items={items}>
            <CommandCollection>
              {(item) => (
                <CommandItem
                  value={item.value}
                  active={highlightedItemValue === item.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    props.setOpen(false);
                    void item.run();
                  }}
                >
                  {item.icon}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm leading-4">{item.title}</span>
                    <span className="truncate text-xs leading-4 text-secondary-label">
                      {item.description}
                    </span>
                  </span>
                </CommandItem>
              )}
            </CommandCollection>
          </CommandGroup>
        </CommandList>
      ) : (
        <CommandPaletteResults
          groups={
            items.length > 0
              ? [{ value: "project-files", label: redesign ? "" : target.projectName, items }]
              : []
          }
          highlightedItemValue={highlightedItemValue}
          isActionsOnly={false}
          keybindings={keybindings}
          onExecuteItem={(item) => {
            if (item.kind !== "action") return;
            props.setOpen(false);
            void item.run();
          }}
          emptyStateMessage={emptyStateMessage}
        />
      )}
    </CommandPaletteContent>
  );
}

export function ProjectFilePicker(props: ProjectFilePickerProps) {
  const target = useActiveProjectTarget();

  if (!target) {
    return <EmptyProjectFilePicker />;
  }

  return <OpenProjectFilePicker setOpen={props.setOpen} target={target} />;
}
