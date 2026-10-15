"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PitchData } from "@/lib/cards";
import { CardHeading, WhatsAppBadge, WhatsAppIcon } from "./shared";

export function PitchCard({ data }: { data: PitchData }) {
  const [message, setMessage] = useState(data.message);
  const href = `https://wa.me/${data.phone}?text=${encodeURIComponent(message)}`;

  return (
    <div className="flex flex-col gap-3">
      <CardHeading
        icon={<MessageCircle />}
        title={`Pitch for ${data.business}`}
        subtitle={`+${data.phone}`}
        aside={<WhatsAppBadge label={data.whatsapp} />}
      />
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        className="resize-none text-sm leading-relaxed"
        aria-label="Pitch message"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{message.length} characters · review before sending</span>
        <Button
          nativeButton={false}
          render={<a href={href} target="_blank" rel="noopener noreferrer" />}
          className="bg-emerald-600 text-white hover:bg-emerald-600/90"
        >
          <WhatsAppIcon />
          Open in WhatsApp
        </Button>
      </div>
    </div>
  );
}
