-- Migration to add content_calendar table for automated blog/social pipeline
CREATE TYPE content_status AS ENUM ('pending', 'generated', 'reviewing', 'published');

CREATE TABLE public.content_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL,
    keywords TEXT[] DEFAULT '{}',
    target_locality TEXT,
    status content_status DEFAULT 'pending',
    scheduled_for TIMESTAMPTZ,
    blog_content TEXT,
    google_flow_media_url TEXT,
    social_caption_ig TEXT,
    social_caption_fb TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE public.content_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to public for published content"
    ON public.content_calendar
    FOR SELECT
    USING (status = 'published');

CREATE POLICY "Allow full access for authenticated admin users"
    ON public.content_calendar
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Function to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_content_calendar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_content_calendar_updated_at
BEFORE UPDATE ON public.content_calendar
FOR EACH ROW
EXECUTE FUNCTION update_content_calendar_updated_at();
