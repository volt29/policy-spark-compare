-- Ensure existing document paths store only the object key without bucket prefix
update public.documents
set file_path = regexp_replace(file_path, '^insurance-documents/', '')
where file_path like 'insurance-documents/%';
