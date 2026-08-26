"use client";

import { FlightStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { statusText } from "@/lib/i18n/format";

export function StatusBadge({
  status,
  delayMinutes,
  className,
}: {
  status: FlightStatus;
  delayMinutes?: number | null;
  className?: string;
}) {
  const { locale } = usePrefs();
  const t = useT();
  const label = statusText(status, locale, delayMinutes);

  if (status === FlightStatus.EN_ROUTE || status === FlightStatus.DEPARTED) {
    return (
      <Badge variant="live" className={className}>
        <span className="mr-1.5 size-1.5 rounded-full bg-primary" />
        {label}
      </Badge>
    );
  }
  if (status === FlightStatus.DELAYED) {
    return <Badge variant="warning" className={className}>{label}</Badge>;
  }
  if (status === FlightStatus.CANCELLED || status === FlightStatus.DIVERTED) {
    return <Badge variant="destructive" className={className}>{label}</Badge>;
  }
  if (status === FlightStatus.LANDED || status === FlightStatus.SCHEDULED || status === FlightStatus.BOARDING) {
    return (
      <Badge variant="success" className={className}>
        {status === FlightStatus.SCHEDULED ? t("status.onTime") : label}
      </Badge>
    );
  }
  return <Badge className={className}>{label}</Badge>;
}
