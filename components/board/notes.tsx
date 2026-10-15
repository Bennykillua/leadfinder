"use client";

import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useLeadActions } from "@/lib/lead-store";
import type { Lead, Note } from "@/lib/leads";

// Many notes per lead, newest first. Add, edit and delete (with a confirm step).
export function Notes({ lead }: { lead: Lead }) {
  const { addNote } = useLeadActions();
  const [draft, setDraft] = useState("");

  function add() {
    if (!draft.trim()) return;
    addNote(lead.id, draft);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Textarea
          aria-label="New note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Spoke to the manager, call back after the 20th."
          rows={3}
          maxLength={5000}
          className="resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to add</span>
          <Button type="submit" size="sm" variant="secondary" disabled={!draft.trim()}>
            <Plus />
            Add note
          </Button>
        </div>
      </form>

      {lead.notes.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {lead.notes.map((n) => (
            <NoteItem key={n.id} leadId={lead.id} note={n} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
    </div>
  );
}

function NoteItem({ leadId, note }: { leadId: string; note: Note }) {
  const { updateNote, deleteNote } = useLeadActions();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [confirming, setConfirming] = useState(false);
  const edited = note.updatedAt !== note.createdAt;

  function save() {
    if (!text.trim()) return;
    if (text.trim() !== note.body) updateNote(leadId, note.id, text);
    setEditing(false);
  }

  return (
    <li className="group/note rounded-lg bg-muted/50 p-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="Edit note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setText(note.body);
                setEditing(false);
              }
            }}
            rows={3}
            maxLength={5000}
            autoFocus
            className="resize-y bg-background"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(note.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!text.trim()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap">{note.body}</p>
          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNowStrict(new Date(note.createdAt))} ago{edited ? " · edited" : ""}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setText(note.body);
                setEditing(true);
              }}
              aria-label="Edit note"
              title="Edit note"
            >
              <Pencil />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setConfirming(true)}
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 />
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this note?"
        description="This can't be undone."
        onConfirm={() => deleteNote(leadId, note.id)}
      />
    </li>
  );
}
