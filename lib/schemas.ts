import { z } from "zod";
import type { Column } from "@/lib/leads";

// Shapes the server accepts from the browser. Everything is validated before it
// touches the database or the crawler.

export const column = z.enum(["saved", "pitched", "replied", "won", "lost"] satisfies Column[]);

export const evidenceItem = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(["check", "finding", "review", "timing"]),
  label: z.string().max(100),
  ok: z.boolean().nullable(),
  detail: z.string().max(600),
  check: z.string().max(300).optional(),
});

export const business = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  category: z.string().max(200),
  area: z.string().max(300),
  phone: z.string().max(40),
  whatsapp: z.enum(["confirmed", "likely", "call"]),
  rating: z.number().min(0).max(5),
  reviews: z.number().int().min(0),
  website: z.string().max(500).nullable(),
  email: z.string().email().max(200).nullable(),
  whatsappPhone: z.string().regex(/^\d{8,15}$/).nullable(),
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  phoneIntl: z.string().regex(/^\d{6,15}$/).nullable(),
  auditedAt: z.iso.datetime().nullable(),
  score: z.number().int().min(1).max(5).nullable(),
  topReason: z.string().max(500),
  evidence: z.array(evidenceItem).max(40),
});

export const reminder = z.object({ at: z.iso.datetime(), note: z.string().max(200) }).nullable();

export const noteBody = z.string().trim().min(1, "Write something first").max(5000);

export const note = z.object({
  id: z.uuid(),
  body: noteBody,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const lead = business.extend({
  status: column,
  pitch: z.string().max(5000),
  notes: z.array(note).max(500),
  reminder,
  ai: z
    .object({
      score: z.number().int().min(1).max(5),
      topReason: z.string().max(500),
      findings: z.array(evidenceItem).max(3),
      timing: z.array(evidenceItem).max(6),
      model: z.string().max(100),
      at: z.iso.datetime(),
    })
    .nullable(),
  reviewSamples: z
    .object({
      fetchedAt: z.iso.datetime(),
      sort: z.string().max(40),
      items: z
        .array(
          z.object({
            id: z.string().max(40),
            rating: z.number().min(0).max(5),
            date: z.string().max(60),
            isoDate: z.string().max(40).nullable(),
            text: z.string().max(1200),
          }),
        )
        .max(20),
    })
    .nullable(),
  pitchEvidence: z.array(evidenceItem).max(20),
});

export const patch = z
  .object({
    status: column,
    pitch: z.string().max(5000),
    reminder,
    pitchEvidence: z.array(evidenceItem).max(20),
  })
  .partial();

