import { z } from "zod";
import type { Column } from "@/lib/leads";

// Shapes the server accepts from the browser. Everything is validated before it
// touches the database or the crawler.

export const column = z.enum(["saved", "pitched", "replied", "won", "lost"] satisfies Column[]);

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
  auditedAt: z.iso.datetime().nullable(),
  score: z.number().int().min(1).max(5).nullable(),
  topReason: z.string().max(500),
  evidence: z.array(z.object({ label: z.string().max(100), ok: z.boolean().nullable(), detail: z.string().max(300) })).max(30),
});

export const reminder = z.object({ at: z.iso.datetime(), note: z.string().max(200) }).nullable();

export const lead = business.extend({
  status: column,
  pitch: z.string().max(5000),
  notes: z.string().max(10000),
  reminder,
});

export const patch = z
  .object({
    status: column,
    pitch: z.string().max(5000),
    notes: z.string().max(10000),
    reminder,
  })
  .partial();

