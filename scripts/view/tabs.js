//part of the view Layer
//allows to switch between workspace and help tabs
//ONLY handles showing and hiding panels. 

const tabs = document.querySelectorAll('[role = "tab"]');

function showTab(selectedTab)
{
	tabs.forEach(function(tab)
	{
			const isSelected = tab === selectedTab;
			const panel = document.getElementById(tab.getAttribute('aria-controls'));
			
			tab.setAttribute('aria-selected', isSelected);
			panel.hidden = !isSelected;
	});
}

tabs.forEach(function (tab)
{
	tab.addEventListener('click', function () 
	{
		showTab(tab);
	});
});