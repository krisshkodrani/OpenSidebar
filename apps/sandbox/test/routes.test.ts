import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAppUrl, safeReturnPath, signInHref, isAppRoute, routes } from "../src/app/routes.js";
test("legacy bookmarks and trailing slashes preserve query and fragment",()=>{
  for(const [oldPath,newPath] of [["/account",routes.settings],["/app/account",routes.settings],["/dashboard",routes.overview],["/playground",routes.playground],["/viewer",routes.viewer],["/sessions",routes.sessions]])
    assert.equal(normalizeAppUrl(new URL(`https://opensidebar.com${oldPath}/?item=two%20words#detail`)),`${newPath}?item=two%20words#detail`);
});
test("old playground auth links reach sign-in and return to the playground",()=>{
 const next=normalizeAppUrl(new URL("https://opensidebar.com/playground?auth=1&scenario=restock-alert"))!;
 const url=new URL(next,"https://opensidebar.com");assert.equal(url.pathname,routes.signIn);assert.equal(url.searchParams.get("return"),"/app/playground?scenario=restock-alert");
});
test("authentication returns only to known workspace routes",()=>{
 for(const bad of [null,"https://evil.example/app","//evil.example/app","/\\evil.example/app","/app/sign-in?return=/app","/app/unknown","/api/v1/account","javascript:alert(1)"])
  assert.equal(safeReturnPath(bad),routes.overview);
 assert.equal(safeReturnPath("/app/sessions?session=owned-session#details"),"/app/sessions?session=owned-session#details");
 assert.equal(safeReturnPath("/account?auth=1&return=https://evil.example&view=all"),"/app/settings?view=all");
});
test("canonical pages stay stable and unknown routes never become playgrounds",()=>{
 for(const path of Object.values(routes)){assert(isAppRoute(path));assert.equal(normalizeAppUrl(new URL(`https://opensidebar.com${path}`)),null);}
 assert(!isAppRoute("/app/unknown"));assert.equal(new URL(signInHref("/app/settings/providers"),"https://opensidebar.com").searchParams.get("return"),"/app/settings/providers");
});
