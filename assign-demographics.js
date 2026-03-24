// ============================================================
// Paste this entire script into the browser console on your
// Creator Roster app to bulk-assign Male/Female demographics.
//
// It previews all assignments first — type Y to confirm.
// ============================================================

(function assignGenderDemographics() {
  // Common first-name → gender lookup (US-centric)
  const MALE_NAMES = new Set([
    'aaron','adam','adrian','aidan','alan','alex','alexander','andrew','andy','anthony',
    'antonio','austin','ben','benjamin','blake','brad','bradley','brandon','brent','brett',
    'brian','bruce','bryce','caleb','cameron','carl','carlos','casey','chad','charles',
    'chase','chris','christian','christopher','clay','cody','cole','colin','connor','corey',
    'craig','dale','dalton','damian','dan','daniel','danny','darian','darren','david',
    'dean','dennis','derek','devin','dominic','don','donald','doug','douglas','drew',
    'duncan','dustin','dylan','ed','eddie','edward','eli','elijah','elliot','eric',
    'erik','ethan','evan','felix','frank','fred','gabriel','garrett','gary','gavin',
    'george','gordon','graham','grant','greg','gregory','griffin','hank','harrison','harry',
    'hayden','henry','howard','hunter','ian','isaac','isaiah','jack','jackson','jacob',
    'jake','james','jared','jason','jay','jeff','jeffrey','jeremiah','jeremy','jerry',
    'jesse','jim','jimmy','joe','joel','john','johnny','jon','jonathan','jordan',
    'jose','joseph','josh','joshua','juan','julian','justin','karl','keith','ken',
    'kenneth','kevin','kurt','kyle','lance','larry','leo','leon','liam','logan',
    'louis','lucas','luis','luke','marcus','mario','mark','marshall','martin','mason',
    'matt','matthew','max','michael','miguel','mike','miles','mitchell','nathan','nathaniel',
    'neil','nick','nicholas','noah','nolan','oliver','omar','oscar','owen','patrick',
    'paul','peter','phil','philip','preston','quentin','rafael','ralph','ramon','randy',
    'ray','raymond','reed','remy','rex','richard','rick','riley','rob','robert',
    'rodney','roger','roman','ronald','ross','roy','russell','ryan','sam','samuel',
    'scott','sean','sebastian','seth','shane','shaun','shawn','simon','spencer','stanley',
    'stephen','steve','steven','stuart','ted','terry','thomas','tim','timothy','todd',
    'tom','tommy','tony','travis','trent','trevor','troy','tyler','victor','vincent',
    'wade','warren','wayne','wesley','william','wyatt','zach','zachary','zane'
  ]);

  const FEMALE_NAMES = new Set([
    'abby','abigail','adriana','adrienne','alexandra','alexis','alice','alicia','alison',
    'allison','alyssa','amanda','amber','amy','ana','andrea','angela','angelica','angelina',
    'angie','anna','anne','annie','april','ariana','ashley','audrey','autumn','ava',
    'bailey','barbara','becky','bella','beth','bethany','bianca','bonnie','brandi','brandy',
    'breanna','brenda','brianna','bridget','brittany','brittney','brooke','caitlin','caitlyn',
    'camille','candice','cara','carly','carmen','carol','caroline','carrie','casey',
    'cassandra','cassie','catherine','chloe','christina','christine','cindy','claire','clara',
    'claudia','colleen','courtney','crystal','cynthia','daisy','dana','danielle','daphne',
    'dawn','debbie','deborah','denise','destiny','diana','diane','donna','dorothy','elena',
    'elise','elizabeth','ella','ellen','emily','emma','erica','erika','erin','eva',
    'evelyn','faith','felicia','fiona','francesca','gabriela','gabrielle','gina','grace',
    'gwendolyn','hailey','haley','hannah','harper','hayley','heather','helen','hillary',
    'holly','hope','irene','iris','isabel','isabella','ivy','jackie','jacqueline','jade',
    'jamie','jane','janet','janice','jasmine','jean','jenna','jennifer','jenny','jessica',
    'jill','joan','joanna','jocelyn','jordan','joy','joyce','julia','juliana','julie',
    'kaitlyn','karen','kate','katherine','kathleen','kathryn','katie','katrina','kayla',
    'kelley','kelly','kelsey','kendra','kerry','kim','kimberly','krista','kristen',
    'kristin','kristina','kristy','kylie','lacey','larissa','laura','lauren','leah','lena',
    'leslie','lily','linda','lindsay','lindsey','lisa','logan','lorena','lori','lucia',
    'lucy','lydia','lynn','mackenzie','madeline','madison','maggie','mallory','mandy',
    'margaret','maria','mariah','marie','marilyn','marina','marlena','martha','mary',
    'maya','megan','meghan','melanie','melissa','melody','mercedes','meredith','mia',
    'michaela','michelle','miranda','molly','monica','morgan','nadia','nancy','natalie',
    'natasha','nicole','nina','nora','olivia','paige','pamela','patricia','paula','penny',
    'peyton','rachel','raquel','rebecca','regina','renee','riley','robin','rosa','rose',
    'roxanne','ruby','ruth','sabrina','sally','samantha','sandra','sandy','sara','sarah',
    'savannah','selena','shannon','sharon','shelby','shelley','sierra','skylar','sofia',
    'sonia','sophia','stacy','stella','stephanie','susan','sydney','sylvia','tamara',
    'tammy','tanya','tara','tatiana','taylor','teresa','tess','tiffany','tina','tracy',
    'trisha','valentina','valerie','vanessa','veronica','victoria','violet','virginia',
    'vivian','wendy','whitney','yolanda','zoe','zoey'
  ]);

  // Ambiguous names that could go either way
  const AMBIGUOUS = new Set([
    'alex','avery','bailey','blake','cameron','casey','charlie','dakota','drew','emery',
    'finley','harper','hayden','jamie','jesse','jordan','kai','kelly','kendall','logan',
    'morgan','parker','pat','peyton','quinn','reese','riley','robin','rowan','sage',
    'sam','sawyer','skylar','taylor','terry'
  ]);

  const assignments = [];
  const skipped = [];

  creators.forEach(c => {
    const first = (c.firstName || '').trim().toLowerCase();
    const existing = (c.demographics || []);
    const hasGender = existing.includes('Male') || existing.includes('Female') || existing.includes('Non-Binary');

    if (hasGender) {
      // Already assigned — skip
      return;
    }

    if (!first) {
      skipped.push({ name: getFullName(c), reason: 'no first name' });
      return;
    }

    // Check female first (more specific), then male
    if (FEMALE_NAMES.has(first) && !AMBIGUOUS.has(first)) {
      assignments.push({ id: c.id, name: getFullName(c), gender: 'Female' });
    } else if (MALE_NAMES.has(first) && !AMBIGUOUS.has(first)) {
      assignments.push({ id: c.id, name: getFullName(c), gender: 'Male' });
    } else {
      skipped.push({ name: getFullName(c), firstName: first, reason: 'ambiguous/unknown name' });
    }
  });

  // Display preview
  console.log('%c━━━ DEMOGRAPHIC ASSIGNMENTS PREVIEW ━━━', 'font-weight:bold; font-size:14px; color:#8EAE8B');
  console.table(assignments.map(a => ({ Name: a.name, Assign: a.gender })));

  if (skipped.length > 0) {
    console.log('%c━━━ SKIPPED (need manual review) ━━━', 'font-weight:bold; font-size:14px; color:#C97B7B');
    console.table(skipped.map(s => ({ Name: s.name, 'First Name': s.firstName || '—', Reason: s.reason })));
  }

  console.log(`\n${assignments.length} to assign, ${skipped.length} skipped.`);

  if (assignments.length === 0) {
    console.log('Nothing to do!');
    return;
  }

  // Ask for confirmation
  const ok = confirm(`Assign gender demographics to ${assignments.length} creators?\n\n` +
    assignments.map(a => `${a.name} → ${a.gender}`).join('\n') +
    (skipped.length > 0 ? `\n\n⚠️ ${skipped.length} skipped (ambiguous/unknown) — assign manually` : ''));

  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  // Apply assignments
  let updated = 0;
  assignments.forEach(a => {
    const creator = creators.find(c => c.id === a.id);
    if (!creator) return;
    if (!creator.demographics) creator.demographics = [];
    if (!creator.demographics.includes(a.gender)) {
      creator.demographics.push(a.gender);
      creator.updatedAt = new Date().toISOString();
      db.upsert(creator);
      updated++;
    }
  });

  console.log(`%c✓ Updated ${updated} creators!`, 'font-weight:bold; color:#8EAE8B; font-size:13px');

  // Re-render UI
  if (typeof renderRosterTab === 'function') renderRosterTab();
  if (typeof renderDispatchFilterPills === 'function') renderDispatchFilterPills();

  // Return skipped for manual follow-up
  if (skipped.length > 0) {
    console.log('%cSkipped creators (assign manually via Edit):', 'color:#C97B7B');
    skipped.forEach(s => console.log(`  → ${s.name} (${s.reason})`));
  }
})();
