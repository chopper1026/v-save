const fs = require('node:fs');
const path = require('node:path');
const plist = require('plist');

const PUSH_ENTITLEMENT_KEY = 'aps-environment';

function stripUnsupportedPushEntitlements(entitlements = {}) {
  const next = { ...entitlements };
  delete next[PUSH_ENTITLEMENT_KEY];
  return next;
}

function stripPushEntitlementFile(entitlementsPath) {
  if (!fs.existsSync(entitlementsPath)) {
    return {
      changed: false,
      exists: false,
      entitlementsPath,
    };
  }

  const raw = fs.readFileSync(entitlementsPath, 'utf8');
  const parsed = plist.parse(raw);
  const next = stripUnsupportedPushEntitlements(parsed);
  const changed = JSON.stringify(parsed) !== JSON.stringify(next);

  if (changed) {
    fs.writeFileSync(entitlementsPath, plist.build(next));
  }

  return {
    changed,
    exists: true,
    entitlementsPath,
  };
}

function getDefaultEntitlementsPath(projectRoot = process.cwd()) {
  return path.join(projectRoot, 'ios', 'VSAVE', 'VSAVE.entitlements');
}

if (require.main === module) {
  const entitlementsPath = process.argv[2] || getDefaultEntitlementsPath();
  const result = stripPushEntitlementFile(entitlementsPath);
  const label = path.relative(process.cwd(), entitlementsPath) || entitlementsPath;

  if (!result.exists) {
    console.log(`Skipped iOS push entitlement cleanup: ${label} not found`);
  } else if (result.changed) {
    console.log(`Removed aps-environment from ${label}`);
  } else {
    console.log(`No aps-environment entitlement found in ${label}`);
  }
}

module.exports = {
  getDefaultEntitlementsPath,
  stripPushEntitlementFile,
  stripUnsupportedPushEntitlements,
};
