
//part of the view Layer
//allows to switch between workspace and help tabs
//ONLY handles showing and hiding panels.

const tabs = document.querySelectorAll('[role = "tab"]');

function showTab(selectedTab)
{
    if (!selectedTab) {
        return;
    }

    tabs.forEach(function(tab)
    {
        const isSelected = tab === selectedTab;
        const panel = document.getElementById(
            tab.getAttribute('aria-controls')
        );

        // Keep the selected tab and its accessibility state updated
        tab.setAttribute('aria-selected', String(isSelected));
        tab.tabIndex = isSelected ? 0 : -1;

        // Do not crash if a tab points to a missing panel
        if (panel) {
            panel.hidden = !isSelected;
        } else {
            console.warn(
                "Tab panel not found:",
                tab.getAttribute('aria-controls')
            );
        }
    });
}

tabs.forEach(function (tab, index)
{
    tab.addEventListener('click', function ()
    {
        showTab(tab);
    });

    // Allow keyboard users to switch tabs with arrow keys
    tab.addEventListener('keydown', function (event)
    {
        let nextIndex = index;

        if (event.key === 'ArrowRight') {
            nextIndex = (index + 1) % tabs.length;
        } else if (event.key === 'ArrowLeft') {
            nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = tabs.length - 1;
        } else {
            return;
        }

        event.preventDefault();

        const nextTab = tabs[nextIndex];

        showTab(nextTab);
        nextTab.focus();
    });
});

// Show the tab selected in HTML when the page first loads.
// If no tab is selected, show the first one.
if (tabs.length > 0) {

    const initiallySelectedTab =
        Array.from(tabs).find(function(tab) {
            return tab.getAttribute('aria-selected') === 'true';
        }) || tabs[0];

    showTab(initiallySelectedTab);
}
