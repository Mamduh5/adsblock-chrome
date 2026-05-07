(function exposeSiteShieldProfiles(globalScope) {
  "use strict";

  const schema = globalScope.SiteShieldProfileSchema;
  const definitions = globalScope.SiteShieldProfileDefinitions || [];
  const profiles = definitions.map((profile) => schema.validateProfile(profile));
  const byId = Object.create(null);

  for (const profile of profiles) {
    if (byId[profile.id]) {
      throw new Error("Duplicate Site Shield profile id: " + profile.id);
    }
    byId[profile.id] = profile;
  }

  function isSubdomainOrSame(hostname, rootDomain) {
    const host = schema.normalizeHost(hostname);
    const root = schema.normalizeHost(rootDomain);
    return host === root || host.endsWith("." + root);
  }

  function profileMatchesHostname(profile, hostname) {
    const host = schema.normalizeHost(hostname);
    return profile.domains.some((domain) => {
      const normalizedDomain = schema.normalizeHost(domain);
      return profile.includeSubdomains
        ? isSubdomainOrSame(host, normalizedDomain)
        : host === normalizedDomain;
    });
  }

  function findByHostname(hostname) {
    return profiles.find((profile) => profileMatchesHostname(profile, hostname)) || null;
  }

  function getById(profileId) {
    return byId[profileId] || null;
  }

  function all() {
    return profiles.slice();
  }

  globalScope.SiteShieldProfiles = {
    all,
    findByHostname,
    getById,
    profileMatchesHostname,
    isSubdomainOrSame
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
