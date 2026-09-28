"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Database,
  FlaskConical,
  Home,
  Lightbulb,
  Map,
  MessageSquareMore,
  OctagonAlert,
  Pill,
  Route as RouteIcon,
  Stethoscope,
  Users,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { SidebarTeam } from "@/components/sidebar-team"

const NAV = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/care-journey", label: "Care Journey", icon: RouteIcon },
  { href: "/dropout", label: "Dropout Analysis", icon: AlertTriangle },
  { href: "/medicine-access", label: "Medicine Access", icon: Pill },
  { href: "/labs", label: "Lab Completion", icon: FlaskConical },
  { href: "/reviews", label: "Follow-up Reviews", icon: Stethoscope },
  { href: "/geography", label: "Geography & Access", icon: Map },
  { href: "/facilities", label: "Facility Analysis", icon: Activity },
  { href: "/outreach", label: "Outreach Effectiveness", icon: MessageSquareMore },
  { href: "/segments", label: "Patient Segments", icon: Users },
  { href: "/history", label: "Historical Behaviour", icon: ClipboardList },
  { href: "/data-quality", label: "Data Quality & Linkage", icon: Database },
  { href: "/problems", label: "Problems", icon: OctagonAlert },
  { href: "/findings", label: "Findings", icon: Lightbulb },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <div className="px-2 py-1.5">
          <div className="text-sm font-semibold text-sidebar-foreground">Team Hard Launchers</div>
          <div className="text-[11px] text-muted-foreground">Follow-Up Assurance · INFINIUM 2026</div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton isActive={active} render={<Link href={href} />}>
                      <Icon className="size-4" />
                      {label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarTeam />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
