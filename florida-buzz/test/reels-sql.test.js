const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('actual PostgreSQL migration: additive schema, fenced lease, duplicate journal, caps, one replacement and service-only access',async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table articles(id uuid primary key default gen_random_uuid(),title text);insert into articles(title) values('Existing guide');");
    await db.exec(await fs.readFile(path.join(__dirname,'../supabase/migrations/202610050001_guide_reels.sql'),'utf8'));
    assert.equal((await db.query('select title from articles')).rows[0].title,'Existing guide');
    await db.exec("insert into reel_topics(key,title,destination,angle,seed_order,status) values('proof','Proof','MK','strategy',1,'EXISTING_PROOF'),('christmas','Christmas','MK','value',2,'QUEUED');");
    const claim=(await db.query("select reels_claim('2026-10-05') as value")).rows[0].value;
    assert.equal(claim.package.topic_key,'christmas');assert.equal((await db.query("select reels_claim('2026-10-05') as value")).rows[0].value,null);
    const reserve=async(caps={single:2,package:2,day:2,week:6,month:24},shot=1,attempt=0,balance=5)=>
      (await db.query('select reels_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value',[claim.token,claim.package.id,'clip',shot,attempt,'fal-ai/kling-video/v3/standard/text-to-video',{}, {amount:.42},caps,balance])).rows[0].value;
    const first=await reserve();assert.equal(first.status,'SUBMITTING');assert.equal(first.new_reservation,true);assert.equal((await reserve()).new_reservation,false);
    await assert.rejects(()=>reserve({single:2,package:.5,day:2,week:6,month:24},2),/package spending cap/);
    await assert.rejects(()=>reserve({single:2,package:2,day:.5,week:6,month:24},2),/day spending cap/);
    await assert.rejects(()=>reserve({single:2,package:2,day:2,week:.5,month:24},2),/week spending cap/);
    await assert.rejects(()=>reserve({single:2,package:2,day:2,week:6,month:.5},2),/month spending cap/);
    await assert.rejects(()=>reserve(undefined,2,0,.5),/Insufficient verified/);
    await assert.rejects(()=>reserve(undefined,1,1),/Replacement not authorized/);
    await db.query('select reels_generation_write($1,$2,$3)',[claim.token,first.id,{status:'COMPLETE',actual_usd:.42,review:{classification:'REGENERATE_ONCE'}}]);
    const replacement=await reserve(undefined,1,1);assert.equal(replacement.attempt,1);
    await assert.rejects(()=>reserve(undefined,1,2),/check constraint/);
    const privileges=await db.query("select has_function_privilege('anon','reels_claim(text)','execute') as anon,has_function_privilege('service_role','reels_claim(text)','execute') as service");
    assert.equal(privileges.rows[0].anon,false);assert.equal(privileges.rows[0].service,true);
    await db.exec("update reel_control set expires_at=now()-interval '1 second';");
    await assert.rejects(()=>db.query('select reels_write($1,$2,$3)',[claim.token,claim.package.id,{master:'x'}]),/Worker lease lost/);
    const newer=(await db.query('select reels_claim() as value')).rows[0].value;assert.notEqual(newer.token,claim.token);assert.equal(newer.package.id,claim.package.id);
    await db.query('select reels_write($1,$2,$3,$4)',[newer.token,claim.package.id,{actualCost:.84},'READY_FOR_APPROVAL']);
    await db.query('select reels_lease($1,true)',[newer.token]);
    assert.equal((await db.query("select reels_claim('2026-10-05') as value")).rows[0].value,null,'same schedule slot cannot create another package');
  } finally {await db.close();}
});
