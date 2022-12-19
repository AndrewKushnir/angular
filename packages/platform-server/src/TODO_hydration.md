# Hydration TODO

[+] serialize the basic live dom of a component into its host element
[+] serialize container state
[+] identify templates
[ ] after each findExistingNode call, assert that we found an element of expected type and tag name
[+] remove dehydrated views (examine LContainers) after app became stable
[ ] content projection
[ ] i18n
[ ] collect stats in ngDevMode (# of nodes hydrated, etc)
[ ] *ngFor
[ ] ViewContainerRef.createComponent
[ ] NgTemplateOutlet
[ ] ViewContainerRef and TemplateRef injection
[ ] createComponent and adding hostView to ApplicationRef
[ ] tree-shaking
[ ] better selection of the "anchor" node to generate navigations
[ ] compact ngh data (compress/decompress)
[ ] nested views (for ex. nested `*ngIf`s)
[ ] annotate and find nodes located outside of host elements (for ex. moved to `<body>`)
[ ] test with nested views, when nested views contain other templates and components (check ssrId stability)
[ ] test with Router (`<router-outlet />`)