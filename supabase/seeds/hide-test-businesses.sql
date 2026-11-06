-- Hide test businesses from the admin Website tracker. NOTHING IS DELETED.
-- Sets tenants.settings.test_business = true on 23 named test businesses (by id).
-- Kept visible: Anglesey Windows, RS Locksmiths, Eden Technologies.
-- Left alone (not flagged, and not in the tracker because they have no Stripe subscription): G Lee Security, Grade One Locksmiths.
--
-- Paste step 1 first and check the 23 names. Then paste step 2. Step 3 undoes it.

-- STEP 1 (look only): should list 23 businesses, none of the three you keep.
select id, name, created_at::date as created
from public.tenants
where id in (
  '3077ae26-e050-465e-9df9-ca48eb6b970f','cae6c615-d545-40b0-9ccb-f3269788b9ff','a2b88e68-cf10-4d06-83cd-3a2036cf409d',
  'ce37842c-4ea9-465f-a3d4-33841be782a3','8e4ab296-1a85-4c80-b517-a3e460d321f2','a003e209-f26c-402c-9e4f-0c1aea51b490',
  '82a0086d-2636-4919-acdb-183bc5a2a23b','c99e9ee9-9c6d-4fb4-8038-2b17808b6290','f9e48700-5db7-48cd-a1af-b8e58fb76e83',
  'cd56ee2e-4b6c-47c6-af0e-2e73f989d28f','48fce507-984d-4f43-be3e-8f0bc6d6fc82','b2c1a6ac-b9fd-4a2e-97b9-b8404359877b',
  '5e43e8c7-196d-4cd4-84e1-9a88006d872d','1bc1363b-cdd5-454c-947b-b76b62559184','03b9f56c-62b5-4a5f-b916-f5e282ceecb0',
  'ac219bcd-1306-4ee9-b6f0-46e7f90a3819','e98ea18c-7327-4eb5-8f78-1f5da3e6983b','f402d799-a2ce-4c90-ba26-922b169f7864',
  '9a9540a7-b19a-469b-9b5e-de75b6c0fd08','2ccc5194-b3c4-4d65-8db2-3f1fa6019b6f','490f08b2-0a94-493d-8516-85c70781acee',
  'f571681c-3054-4836-8086-11c1777fc4ea','833c68be-9598-4b6a-a458-3d7a03f39410'
)
order by created_at desc;

-- STEP 2 (the change): flags them. Other settings on each business are kept.
update public.tenants
set settings = coalesce(settings, '{}'::jsonb) || '{"test_business": true}'::jsonb
where id in (
  '3077ae26-e050-465e-9df9-ca48eb6b970f','cae6c615-d545-40b0-9ccb-f3269788b9ff','a2b88e68-cf10-4d06-83cd-3a2036cf409d',
  'ce37842c-4ea9-465f-a3d4-33841be782a3','8e4ab296-1a85-4c80-b517-a3e460d321f2','a003e209-f26c-402c-9e4f-0c1aea51b490',
  '82a0086d-2636-4919-acdb-183bc5a2a23b','c99e9ee9-9c6d-4fb4-8038-2b17808b6290','f9e48700-5db7-48cd-a1af-b8e58fb76e83',
  'cd56ee2e-4b6c-47c6-af0e-2e73f989d28f','48fce507-984d-4f43-be3e-8f0bc6d6fc82','b2c1a6ac-b9fd-4a2e-97b9-b8404359877b',
  '5e43e8c7-196d-4cd4-84e1-9a88006d872d','1bc1363b-cdd5-454c-947b-b76b62559184','03b9f56c-62b5-4a5f-b916-f5e282ceecb0',
  'ac219bcd-1306-4ee9-b6f0-46e7f90a3819','e98ea18c-7327-4eb5-8f78-1f5da3e6983b','f402d799-a2ce-4c90-ba26-922b169f7864',
  '9a9540a7-b19a-469b-9b5e-de75b6c0fd08','2ccc5194-b3c4-4d65-8db2-3f1fa6019b6f','490f08b2-0a94-493d-8516-85c70781acee',
  'f571681c-3054-4836-8086-11c1777fc4ea','833c68be-9598-4b6a-a458-3d7a03f39410'
)
returning id, name;

-- STEP 3 (undo, only if you want them back in the list):
-- update public.tenants set settings = settings - 'test_business' where settings ? 'test_business';
