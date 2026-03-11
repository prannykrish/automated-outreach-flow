-- Enable Realtime for inbound_emails so the inbox notification badge updates instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_emails;
