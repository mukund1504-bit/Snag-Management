-- ====== SUPABASE DATABASE SCHEMA FOR SNAG MANAGEMENT SYSTEM ======
-- Table Name: snag_management (STANDARDIZED - all lowercase)
-- Purpose: Core defect/snag records storage
-- Last Updated: 2026-06-28

-- ====== 1. CREATE MAIN SNAG_MANAGEMENT TABLE ======
CREATE TABLE IF NOT EXISTS public.snag_management (
    id BIGSERIAL PRIMARY KEY,
    
    -- Project & Location Fields
    project VARCHAR(255) NOT NULL,
    tower VARCHAR(255) NOT NULL,
    floor VARCHAR(255) NOT NULL,
    flat VARCHAR(255) NOT NULL,
    
    -- Defect Classification (STANDARDIZED FIELDS)
    defect_category VARCHAR(255) NOT NULL,
    specification_matrix VARCHAR(255) NOT NULL,
    
    -- Status & Metadata
    status VARCHAR(50) NOT NULL DEFAULT 'Open',
    intensity VARCHAR(50),
    remark TEXT,
    
    -- Timeline Fields (STANDARDIZED)
    logged_date DATE NOT NULL,
    sla_due_date DATE,
    closed_date DATE,
    delay VARCHAR(100),
    
    -- User Tracking (STANDARDIZED)
    created_by VARCHAR(255) NOT NULL,
    closed_by VARCHAR(255),
    
    -- Location Mapping
    map_x NUMERIC(10, 2),
    map_y NUMERIC(10, 2),
    map_thumbnail TEXT,
    
    -- Photo Evidence
    photos TEXT,
    final_photos TEXT,
    
    -- System Fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexing for Performance
    CONSTRAINT snag_valid_status CHECK (status IN ('Open', 'In Progress', 'Closed')),
    CONSTRAINT snag_valid_intensity CHECK (intensity IN ('Low', 'Medium', 'High'))
);

-- Create indexes for frequently queried fields
CREATE INDEX IF NOT EXISTS idx_snag_project ON public.snag_management(project);
CREATE INDEX IF NOT EXISTS idx_snag_tower ON public.snag_management(tower);
CREATE INDEX IF NOT EXISTS idx_snag_status ON public.snag_management(status);
CREATE INDEX IF NOT EXISTS idx_snag_logged_date ON public.snag_management(logged_date);
CREATE INDEX IF NOT EXISTS idx_snag_defect_category ON public.snag_management(defect_category);
CREATE INDEX IF NOT EXISTS idx_snag_created_by ON public.snag_management(created_by);

-- ====== 2. CREATE SNAG_MAPS TABLE FOR FLOOR PLANS ======
CREATE TABLE IF NOT EXISTS public.snag_maps (
    id BIGSERIAL PRIMARY KEY,
    map_key VARCHAR(255) NOT NULL UNIQUE,
    base64_image TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snag_maps_key ON public.snag_maps(map_key);

-- ====== 3. ENABLE ROW LEVEL SECURITY (RLS) ======
ALTER TABLE public.snag_management ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snag_maps ENABLE ROW LEVEL SECURITY;

-- ====== 4. CREATE RLS POLICIES - ANON READ (For initial setup, can be restricted) ======
CREATE POLICY "Enable read access for all users" 
ON public.snag_management 
FOR SELECT 
USING (true);

CREATE POLICY "Enable insert for authenticated users" 
ON public.snag_management 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" 
ON public.snag_management 
FOR UPDATE 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Enable read access for maps" 
ON public.snag_maps 
FOR SELECT 
USING (true);

CREATE POLICY "Enable insert for maps" 
ON public.snag_maps 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Enable update for maps" 
ON public.snag_maps 
FOR UPDATE 
USING (true) 
WITH CHECK (true);

-- ====== 5. CREATE FUNCTION FOR AUTO TIMESTAMP UPDATE ======
CREATE OR REPLACE FUNCTION update_snag_management_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_snag_management_timestamp_trigger
BEFORE UPDATE ON public.snag_management
FOR EACH ROW
EXECUTE FUNCTION update_snag_management_timestamp();

-- ====== 6. CREATE FUNCTION FOR AUTO MAPS TIMESTAMP UPDATE ======
CREATE OR REPLACE FUNCTION update_snag_maps_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_snag_maps_timestamp_trigger
BEFORE UPDATE ON public.snag_maps
FOR EACH ROW
EXECUTE FUNCTION update_snag_maps_timestamp();

-- ====== 7. ENABLE REALTIME REPLICATION (FOR LIVE SYNC) ======
ALTER PUBLICATION supabase_realtime ADD TABLE public.snag_management;
ALTER PUBLICATION supabase_realtime ADD TABLE public.snag_maps;

-- ====== 8. SAMPLE INSERT QUERIES ======
-- Example 1: Insert a new defect record
-- INSERT INTO public.snag_management (
--     project, tower, floor, flat,
--     defect_category, specification_matrix,
--     status, intensity, remark,
--     logged_date, sla_due_date,
--     created_by,
--     photos, map_x, map_y, map_thumbnail
-- ) VALUES (
--     'Fragrance', 'Tower-A', '1st Floor', '101',
--     'RCC Structure', 'Level uneven',
--     'Open', 'Medium', 'Uneven floor surface',
--     CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days',
--     'Mukund Admin',
--     'base64_photo_string_here', 150.25, 200.50, 'map_thumb_base64'
-- );

-- Example 2: Update defect status to Closed
-- UPDATE public.snag_management 
-- SET status = 'Closed', 
--     closed_date = CURRENT_DATE,
--     closed_by = 'Mukund Admin',
--     final_photos = 'base64_final_photos',
--     updated_at = NOW()
-- WHERE id = 1;

-- ====== 9. QUERY REFERENCE FOR REPORTS ======
-- Get all defects by project
-- SELECT * FROM public.snag_management WHERE project = 'Fragrance' ORDER BY logged_date DESC;

-- Get defects by status
-- SELECT * FROM public.snag_management WHERE status = 'Open' ORDER BY sla_due_date ASC;

-- Get defect count by category
-- SELECT defect_category, COUNT(*) as count FROM public.snag_management GROUP BY defect_category;

-- Get overdue defects (SLA breach)
-- SELECT * FROM public.snag_management 
-- WHERE status != 'Closed' AND sla_due_date < CURRENT_DATE;

-- ====== 10. COMMENT DOCUMENTATION ======
COMMENT ON TABLE public.snag_management IS 'Core snag/defect records with standardized field naming (all lowercase in DB)';
COMMENT ON TABLE public.snag_maps IS 'Floor plan blueprints mapped to project/tower/floor combinations';

COMMENT ON COLUMN public.snag_management.project IS 'Project name (matches UI capitalization but stored as-is)';
COMMENT ON COLUMN public.snag_management.defect_category IS 'Category of defect (was type/categoryId, standardized to defect_category)';
COMMENT ON COLUMN public.snag_management.specification_matrix IS 'Specific defect specification (was defectList, standardized to specification_matrix)';
COMMENT ON COLUMN public.snag_management.logged_date IS 'Date defect was logged (standardized from loggedDate/loggedAt)';
COMMENT ON COLUMN public.snag_management.sla_due_date IS 'SLA due date for resolution (standardized from dueDate/sla)';
COMMENT ON COLUMN public.snag_management.closed_date IS 'Date defect was closed/resolved (standardized from closedDate/closedAt)';
COMMENT ON COLUMN public.snag_management.created_by IS 'User who created the record (standardized from createdBy)';
COMMENT ON COLUMN public.snag_management.closed_by IS 'User who closed the record (standardized from closedBy)';

-- ====== IMPORTANT NOTES ======
-- 1. All field names in DB are lowercase with underscores (snake_case)
-- 2. UI displays with Capital First Letters (Capital Case)
-- 3. JavaScript automatically converts during read/write operations
-- 4. Defect Category & Specification Matrix fields are now standardized across all tables
-- 5. RLS policies are open for development - RESTRICT IN PRODUCTION
-- 6. Realtime subscriptions are enabled for live data sync
-- 7. Timestamps are auto-managed via triggers
-- 8. Check constraints prevent invalid status/intensity values
