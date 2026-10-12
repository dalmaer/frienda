update public.signers
   set name = 'Ivan Lee',
       group_name = 'Ivan Lee and Amanda Dufresne Lee'
 where id = 'ivan';

update public.signers
   set group_name = 'Ivan Lee and Amanda Dufresne Lee'
 where id = 'amanda';
