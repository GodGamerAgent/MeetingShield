import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, Tuple, List
import uuid
import re

class CalendarService:
    """
    Universal Calendar Exporter:
    Generates ready-to-use deep links and RFC-5545 standard .ics payloads for:
    1. Google Calendar
    2. Microsoft Outlook (Web Deeplink)
    3. Apple Calendar / RFC-5545 (.ics)
    """

    @staticmethod
    def _parse_deadline(deadline_str: Optional[str]) -> Tuple[datetime, datetime]:
        """Tries to parse deadline into start and end datetimes, or defaults to tomorrow 10am."""
        now = datetime.now(timezone.utc)
        start = now + timedelta(days=1)
        start = start.replace(hour=10, minute=0, second=0, microsecond=0)

        if deadline_str:
            # Check for day names or times
            clean = deadline_str.lower()
            if "wednesday" in clean:
                days_ahead = (2 - now.weekday()) % 7
                if days_ahead == 0: days_ahead = 7
                start = now + timedelta(days=days_ahead)
                start = start.replace(hour=15, minute=0, second=0, microsecond=0)
            elif "thursday" in clean:
                days_ahead = (3 - now.weekday()) % 7
                if days_ahead == 0: days_ahead = 7
                start = now + timedelta(days=days_ahead)
                start = start.replace(hour=17, minute=0, second=0, microsecond=0)
            elif "friday" in clean:
                days_ahead = (4 - now.weekday()) % 7
                if days_ahead == 0: days_ahead = 7
                start = now + timedelta(days=days_ahead)
                start = start.replace(hour=12, minute=0, second=0, microsecond=0)

        end = start + timedelta(minutes=45)
        return start, end

    @classmethod
    def generate_calendar_links(
        cls,
        title: str,
        description: str = "",
        deadline_str: Optional[str] = None,
        attendees: Optional[list] = None
    ) -> Dict[str, Any]:
        start_dt, end_dt = cls._parse_deadline(deadline_str)

        # Formats for Google Calendar (YYYYMMDDTHHMMSSZ)
        g_start = start_dt.strftime("%Y%m%dT%H%M%SZ")
        g_end = end_dt.strftime("%Y%m%dT%H%M%SZ")

        # Formats for Outlook (ISO-8601)
        iso_start = start_dt.isoformat()
        iso_end = end_dt.isoformat()

        # Clean strings
        safe_title = title.strip()
        safe_desc = description.strip()
        if deadline_str:
            safe_desc += f"\n\n[Deadline Reference: {deadline_str}]"
        safe_desc += "\n\nCreated by Quorum"

        # 1. Google Calendar URL
        google_params = {
            "action": "TEMPLATE",
            "text": safe_title,
            "dates": f"{g_start}/{g_end}",
            "details": safe_desc,
        }
        google_url = f"https://calendar.google.com/calendar/render?{urllib.parse.urlencode(google_params)}"

        # 2. Microsoft Outlook Web Deeplink
        outlook_params = {
            "path": "/calendar/action/compose",
            "rru": "addevent",
            "subject": safe_title,
            "startdt": iso_start,
            "enddt": iso_end,
            "body": safe_desc
        }
        outlook_url = f"https://outlook.office.com/calendar/0/deeplink/compose?{urllib.parse.urlencode(outlook_params)}"

        # 3. RFC-5545 Standard .ics content
        uid = f"quorum-{uuid.uuid4().hex[:12]}@quorum.local"
        now_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        clean_summary = safe_title.replace("\n", " ").replace(";", "\\;").replace(",", "\\,")
        clean_description = safe_desc.replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")

        ics_content = f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Quorum//Meeting Notes//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:{uid}
DTSTAMP:{now_stamp}
DTSTART:{g_start}
DTEND:{g_end}
SUMMARY:{clean_summary}
DESCRIPTION:{clean_description}
STATUS:CONFIRMED
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR"""

        return {
            "title": safe_title,
            "deadline": deadline_str or start_dt.strftime("%A, %b %d at %I:%M %p UTC"),
            "start_iso": iso_start,
            "end_iso": iso_end,
            "google_calendar_url": google_url,
            "google_url": google_url,
            "outlook_web_url": outlook_url,
            "outlook_url": outlook_url,
            "ics_content": ics_content
        }

calendar_service = CalendarService()
